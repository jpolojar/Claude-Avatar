import express from "express";
import { isLang, type ChatEvent, type HealthResponse } from "../shared/protocol.js";
import { classifyError, streamReply } from "./claude.js";
import { config } from "./config.js";
import { getSession } from "./session.js";

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

  try {
    const result = await streamReply(session, abort.signal, {
      onText: (delta) => send({ type: "delta", text: delta }),
      onReset: () => send({ type: "reset" }),
    });

    // A refused reply (after any fallback) is dropped along with its prompt;
    // an interrupted one is kept up to the point it got to.
    if (result.stopReason === "refusal" || !result.text.trim()) rollback();
    else session.endTurn(result.text, result.aborted);

    const u = result.usage;
    console.log(
      `[chat] ${session.language} · ${result.aborted ? "aborted" : result.stopReason}` +
        ` · TTFT ${fmtMs(result.ttftMs)} · total ${fmtMs(result.totalMs)}` +
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

function fmtMs(ms: number | null): string {
  return ms === null ? "–" : `${Math.round(ms)} ms`;
}

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Avatar server on http://localhost:${config.port} · ${config.model} · effort ${config.effort}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set: copy .env.example to .env and add your key.");
  }
});
