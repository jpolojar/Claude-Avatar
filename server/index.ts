import express from "express";
import { isLang, isServerTtsEngine, type ChatEvent, type HealthResponse } from "../shared/protocol.js";
import { classifyError, streamReply } from "./claude.js";
import { config } from "./config.js";
import { SentenceSplitter } from "./sentences.js";
import { getSession } from "./session.js";
import { MAX_TTS_CHARS, isKnownVoice, listVoices, synthesize } from "./tts/index.js";

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    model: config.model,
    effort: config.effort,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  };
  res.json(body);
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, text, lang } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId || typeof text !== "string" || !text.trim() || !isLang(lang)) {
    res.status(400).json({ error: "Expected { sessionId, text, lang }" });
    return;
  }

  const session = getSession(sessionId, lang);
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
  const sendSentences = (chunks: string[]) => {
    for (const chunk of chunks) {
      firstSentenceMs ??= performance.now() - started;
      send({ type: "sentence", index: sentenceIndex++, text: chunk });
    }
  };

  try {
    const result = await streamReply(session, abort.signal, {
      onText: (delta) => {
        send({ type: "delta", text: delta });
        sendSentences(splitter.push(delta));
      },
      onReset: () => {
        splitter = new SentenceSplitter();
        sentenceIndex = 0;
        send({ type: "reset" });
      },
      onLanguage: (newLang) => {
        session.adoptLanguage(newLang);
        send({ type: "lang", lang: newLang });
      },
    });
    if (!result.aborted) sendSentences(splitter.flush());

    // A refused reply (after any fallback) is dropped along with its prompt;
    // an interrupted one is kept up to the point it got to.
    if (result.stopReason === "refusal" || !result.text.trim()) rollback();
    else session.endTurn(result.text, result.aborted);

    const u = result.usage;
    console.log(
      `[chat] ${session.language} · ${result.aborted ? "aborted" : result.stopReason}` +
        ` · TTFT ${fmtMs(result.ttftMs)} · 1st sentence ${fmtMs(firstSentenceMs)} · total ${fmtMs(result.totalMs)}` +
        (u ? ` · in ${u.inputTokens} (cache read ${u.cacheReadTokens}, write ${u.cacheWriteTokens}) out ${u.outputTokens}` : "") +
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

function fmtMs(ms: number | null): string {
  return ms === null ? "–" : `${Math.round(ms)} ms`;
}

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Avatar server on http://localhost:${config.port} · ${config.model} · effort ${config.effort}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set: copy .env.example to .env and add your key.");
  }
});
