import Anthropic from "@anthropic-ai/sdk";
import type { ChatErrorCode, Usage } from "../shared/protocol.js";
import { config } from "./config.js";
import type { Session } from "./session.js";

// Created on first use so the server still starts (and reports the problem
// per request) when ANTHROPIC_API_KEY is missing from .env.
let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export interface ReplyHandlers {
  onText(delta: string): void;
  /** A server-side fallback took over mid-reply; the partial text was discarded. */
  onReset(): void;
}

export interface ReplyResult {
  text: string;
  stopReason: string | null;
  model: string;
  ttftMs: number | null;
  totalMs: number;
  usage: Usage | null;
  aborted: boolean;
}

export async function streamReply(
  session: Session,
  signal: AbortSignal,
  handlers: ReplyHandlers,
): Promise<ReplyResult> {
  const started = performance.now();
  let ttftMs: number | null = null;
  let text = "";

  try {
    // Thinking is left unset: Opus 5.5 always runs adaptive thinking, and only
    // text deltas are forwarded. `fallbacks: "default"` lets the API re-run a
    // declined request on another model instead of returning a refusal.
    const stream = getClient().beta.messages.stream(
      {
        model: config.model,
        max_tokens: config.maxTokens,
        system: session.system,
        messages: session.messages,
        output_config: { effort: config.effort },
        cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "fallback") {
        text = "";
        handlers.onReset();
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        ttftMs ??= performance.now() - started;
        text += event.delta.text;
        handlers.onText(event.delta.text);
      }
    }
    const message = await stream.finalMessage();
    return {
      text,
      stopReason: message.stop_reason,
      model: message.model,
      ttftMs,
      totalMs: performance.now() - started,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
      aborted: false,
    };
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      return {
        text,
        stopReason: null,
        model: config.model,
        ttftMs,
        totalMs: performance.now() - started,
        usage: null,
        aborted: true,
      };
    }
    throw err;
  }
}

export function classifyError(err: unknown): { code: ChatErrorCode; message: string } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { code: "auth", message: err.message };
  }
  if (err instanceof Anthropic.RateLimitError) return { code: "rate_limit", message: err.message };
  if (err instanceof Anthropic.BadRequestError) return { code: "bad_request", message: err.message };
  if (err instanceof Anthropic.APIConnectionError) return { code: "network", message: err.message };
  if (err instanceof Anthropic.APIError) {
    // 529 overloaded, 5xx server errors (already retried by the SDK).
    return { code: err.status === 529 ? "overloaded" : "api", message: err.message };
  }
  // The SDK throws a plain AnthropicError when no credentials are configured.
  if (err instanceof Anthropic.AnthropicError && /api ?key|auth/i.test(err.message)) {
    return { code: "auth", message: err.message };
  }
  return { code: "api", message: err instanceof Error ? err.message : String(err) };
}
