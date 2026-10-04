import express from "express";
import {
  isLang,
  isServerTtsEngine,
  type ChatEvent,
  type Emotion,
  type HealthResponse,
  type SttResponse,
} from "../shared/protocol.js";
import { classifyError, streamReply } from "./claude.js";
import { config } from "./config.js";
import { emotionChar, takeEmotion } from "./markers.js";
import { SentenceSplitter } from "./sentences.js";
import { clearMemory, currentMemory, getMemory, loadMemory, summarizeSession } from "./memory.js";
import { findSession, getSession, type Session } from "./session.js";
import { transcribe, whisperAvailable } from "./stt.js";
import { MAX_TTS_CHARS, isKnownVoice, listVoices, synthesize } from "./tts/index.js";

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", async (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    model: config.model,
    effort: config.effort,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    whisper: await whisperAvailable(),
  };
  res.json(body);
});

// Always-on listening: the browser posts each detected utterance as a WAV file.
app.post("/api/stt", express.raw({ type: "audio/wav", limit: "20mb" }), async (req, res) => {
  const lang = req.query.lang;
  if (!isLang(lang) || !Buffer.isBuffer(req.body) || req.body.length < 44) {
    res.status(400).json({ error: "Expected a WAV body and ?lang=fi|en" });
    return;
  }
  const started = performance.now();
  try {
    const text = await transcribe(req.body, lang);
    const body: SttResponse = { text, sttMs: performance.now() - started };
    console.log(`[stt] ${lang} · ${Math.round(body.sttMs)} ms · "${text.slice(0, 60)}"`);
    res.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stt] failed: ${message}`);
    res.status(502).json({ error: message });
  }
});

/** How long the text stream may pause before a finished-looking sentence is sent anyway. */
const STREAM_PAUSE_MS = 150;

app.post("/api/chat", async (req, res) => {
  const { sessionId, text, lang, interruption } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId || typeof text !== "string" || !text.trim() || !isLang(lang)) {
    res.status(400).json({ error: "Expected { sessionId, text, lang }" });
    return;
  }

  const session = getSession(sessionId, lang, currentMemory());
  cancelIdleSummary(session.id);
  const spokenText = (interruption as { spokenText?: unknown } | undefined)?.spokenText;
  if (typeof spokenText === "string") session.markInterrupted(spokenText);
  const rollback = session.beginTurn(text.trim(), lang);

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.flushHeaders();
  const send = (event: ChatEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };

  // The client aborts the fetch on barge-in or "new chat"; stop generating (and billing) then.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });

  // Complete sentences go out as soon as they are certain, so the browser can
  // start synthesizing speech while Claude is still writing.
  const started = performance.now();
  let firstSentenceMs: number | null = null;
  let splitter = new SentenceSplitter();
  let sentenceIndex = 0;
  // A mood marked where no sentence follows yet carries over to the next one.
  let carriedEmotion: Emotion | null = null;
  const sendSentences = (chunks: string[]) => {
    for (const chunk of chunks) {
      const { text: sentence, emotion } = takeEmotion(chunk);
      const mood = emotion ?? carriedEmotion;
      if (!sentence) {
        carriedEmotion = mood;
        continue;
      }
      carriedEmotion = null;
      firstSentenceMs ??= performance.now() - started;
      send({ type: "sentence", index: sentenceIndex++, text: sentence, ...(mood ? { emotion: mood } : {}) });
    }
  };
  // Claude's text often arrives in bursts. If a burst ends with what looks
  // like a finished sentence, don't wait for the next burst to confirm it.
  let pauseTimer: NodeJS.Timeout | undefined;
  const onStreamPause = () => sendSentences(splitter.flushIfComplete());

  try {
    const result = await streamReply(session, abort.signal, {
      onText: (delta) => {
        send({ type: "delta", text: delta });
        sendSentences(splitter.push(delta));
        clearTimeout(pauseTimer);
        pauseTimer = setTimeout(onStreamPause, STREAM_PAUSE_MS);
      },
      onReset: () => {
        clearTimeout(pauseTimer);
        splitter = new SentenceSplitter();
        sentenceIndex = 0;
        carriedEmotion = null;
        send({ type: "reset" });
      },
      onLanguage: (newLang) => {
        session.adoptLanguage(newLang);
        send({ type: "lang", lang: newLang });
      },
      // The mood travels inside the splitter so it lands on the right sentence.
      onEmotion: (emotion) => sendSentences(splitter.push(emotionChar(emotion))),
      onSearch: (query) => {
        console.log(`[chat] web search: ${query ?? "(no query)"}`);
        send({ type: "search", query });
      },
      onTextPause: () => {
        clearTimeout(pauseTimer);
        onStreamPause();
      },
    });
    clearTimeout(pauseTimer);
    if (!result.aborted) sendSentences(splitter.flush());

    // A refused reply (after any fallback) is dropped along with its prompt;
    // an interrupted one is kept up to the point it got to.
    if (result.stopReason === "refusal" || !result.text.trim()) rollback();
    else session.endTurn(result.text, result.aborted);
    scheduleIdleSummary(session);

    const u = result.usage;
    console.log(
      `[chat] ${session.language} · ${result.aborted ? "aborted" : result.stopReason}` +
        ` · TTFT ${fmtMs(result.ttftMs)} · 1st sentence ${fmtMs(firstSentenceMs)} · total ${fmtMs(result.totalMs)}` +
        (u ? ` · in ${u.inputTokens} (cache read ${u.cacheReadTokens}, write ${u.cacheWriteTokens}) out ${u.outputTokens}` : "") +
        (u?.webSearches ? ` · ${u.webSearches} web search(es)` : "") +
        ` · ${result.model}`,
    );

    send({
      type: "done",
      stopReason: result.stopReason,
      model: result.model,
      ttftMs: result.ttftMs,
      totalMs: result.totalMs,
      usage: result.usage,
    });
  } catch (err) {
    clearTimeout(pauseTimer);
    rollback();
    const { code, message } = classifyError(err);
    console.error(`[chat] error (${code}): ${message}`);
    send({ type: "error", code, message });
  } finally {
    res.end();
  }
});

app.get("/api/tts/voices", async (_req, res) => {
  res.json(await listVoices());
});

app.post("/api/tts", async (req, res) => {
  const { text, engine, voice, rate } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > MAX_TTS_CHARS ||
    !isServerTtsEngine(engine) ||
    typeof voice !== "string" ||
    !isKnownVoice(engine, voice)
  ) {
    res.status(400).json({ error: "Expected { text, engine, voice, rate } with a known voice" });
    return;
  }
  try {
    const result = await synthesize({ text, engine, voice, rate: typeof rate === "number" ? rate : 0 });
    console.log(`[tts] ${engine}/${voice} · ${Math.round(result.synthMs)} ms · ${text.length} chars`);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tts] ${engine} failed: ${message}`);
    res.status(502).json({ error: message });
  }
});

// --- Memory ---------------------------------------------------------------

const IDLE_SUMMARY_MS = 10 * 60_000;
const idleTimers = new Map<string, NodeJS.Timeout>();

function cancelIdleSummary(sessionId: string): void {
  clearTimeout(idleTimers.get(sessionId));
  idleTimers.delete(sessionId);
}

/** A conversation that has been quiet for 10 minutes is folded into memory. */
function scheduleIdleSummary(session: Session): void {
  cancelIdleSummary(session.id);
  idleTimers.set(
    session.id,
    setTimeout(() => {
      idleTimers.delete(session.id);
      void summarize(session, "idle");
    }, IDLE_SUMMARY_MS),
  );
}

async function summarize(session: Session, reason: string): Promise<void> {
  try {
    const updated = await summarizeSession(session);
    if (updated) console.log(`[memory] updated (${reason})`);
  } catch (err) {
    console.error(`[memory] summary failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

app.get("/api/memory", async (_req, res) => {
  res.json(await getMemory());
});

app.delete("/api/memory", async (_req, res) => {
  await clearMemory();
  console.log("[memory] cleared");
  res.json(await getMemory());
});

// The page sends this (as a beacon) on "new conversation" and when it closes.
app.post("/api/session/end", async (req, res) => {
  const { sessionId } = (req.body ?? {}) as Record<string, unknown>;
  const session = typeof sessionId === "string" ? findSession(sessionId) : undefined;
  if (session) {
    cancelIdleSummary(session.id);
    await summarize(session, "conversation ended");
  }
  res.json(await getMemory());
});

function fmtMs(ms: number | null): string {
  return ms === null ? "–" : `${Math.round(ms)} ms`;
}

await loadMemory();

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Avatar server on http://localhost:${config.port} · ${config.model} · effort ${config.effort}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set: copy .env.example to .env and add your key.");
  }
});
