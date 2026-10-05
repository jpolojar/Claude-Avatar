import Anthropic from "@anthropic-ai/sdk";
import type { ChatErrorCode, Emotion, Lang, Usage } from "../shared/protocol.js";
import { config } from "./config.js";
import { MarkerFilter, type Piece } from "./markers.js";
import type { Session } from "./session.js";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolUnion = Anthropic.Beta.Messages.BetaToolUnion;

// Created on first use so the server still starts (and reports the problem
// per request) when ANTHROPIC_API_KEY is missing from .env.
let client: Anthropic | null = null;
export const getClient = () => (client ??= new Anthropic());

/** The API key changed (the desktop app's settings window): build a new client on next use. */
export function resetClient(): void {
  client = null;
}

/** Checks a key with a free request (lists one model). */
export async function checkApiKey(apiKey: string): Promise<boolean> {
  try {
    await new Anthropic({ apiKey }).models.list({ limit: 1 });
    return true;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return false;
    throw err;
  }
}

/** A long server-tool turn (several searches) may pause; continue it this many times at most. */
const MAX_CONTINUATIONS = 3;

function tools(): ToolUnion[] | undefined {
  if (config.webSearch === "off") return undefined;
  // The 20260209 version filters results with code execution before Claude
  // reads them: more accurate on messy pages, but it adds seconds of silence.
  const type = config.webSearch === "thorough" ? "web_search_20260209" : "web_search_20250305";
  return [{ type, name: "web_search", max_uses: config.webSearchMaxUses, user_location: config.location }];
}

export interface ReplyHandlers {
  /** Text to show and speak (markers removed). */
  onText(delta: string): void;
  /** A server-side fallback took over mid-reply; the partial text was discarded. */
  onReset(): void;
  /** Claude switched the language with a [[fi]]/[[en]] marker. */
  onLanguage(lang: Lang): void;
  /** Claude marked the mood of what follows ([[happy]] etc.). */
  onEmotion(emotion: Emotion): void;
  /** Claude started a web search. */
  onSearch(query: string | null): void;
  /** Text stopped for a tool call: whatever sentence is finished can be spoken now. */
  onTextPause(): void;
}

export interface ReplyResult {
  /** Full reply as generated, markers included (this is what goes into the history). */
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
  let markers = new MarkerFilter();
  const forward = (pieces: Piece[]) => {
    for (const piece of pieces) {
      if (typeof piece === "string") handlers.onText(piece);
      else if (piece.kind === "lang") handlers.onLanguage(piece.lang);
      else handlers.onEmotion(piece.emotion);
    }
  };
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };
  // The session history plus, within this turn, any paused server-tool output.
  const messages: MessageParam[] = [...session.messages];
  // Set by tool blocks; text blocks between citations must not get extra spaces.
  let afterTool = false;

  try {
    for (let continuation = 0; ; continuation++) {
      // Thinking is left unset: Opus 5.5 always runs adaptive thinking, and only
      // text deltas are forwarded. `fallbacks: "default"` lets the API re-run a
      // declined request on another model instead of returning a refusal.
      const stream = getClient().beta.messages.stream(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          system: session.system,
          messages,
          tools: tools(),
          output_config: { effort: config.effort },
          cache_control: { type: "ephemeral" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );

      // Server tool calls stream their input as JSON fragments per block index,
      // or arrive with it complete in the start event.
      const toolInputs = new Map<number, { json: string; initial: unknown }>();
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "text") {
            // Text resuming after a search is a new block: keep the sentences apart.
            if (afterTool && text && !/\s$/.test(text)) {
              text += " ";
              handlers.onText(" ");
            }
            afterTool = false;
          } else if (block.type !== "thinking" && block.type !== "redacted_thinking") {
            afterTool = true;
          }
          if (block.type === "fallback") {
            text = "";
            markers = new MarkerFilter();
            handlers.onReset();
          } else if (block.type === "server_tool_use") {
            handlers.onTextPause();
            if (block.name === "web_search" || block.name === "web_fetch") {
              toolInputs.set(event.index, { json: "", initial: block.input });
            }
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            ttftMs ??= performance.now() - started;
            text += event.delta.text;
            forward(markers.push(event.delta.text));
          } else if (event.delta.type === "input_json_delta") {
            const input = toolInputs.get(event.index);
            if (input) input.json += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const input = toolInputs.get(event.index);
          if (input) {
            toolInputs.delete(event.index);
            handlers.onSearch(queryOf(input.json) ?? queryOf(input.initial));
          }
        }
      }

      const message = await stream.finalMessage();
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
      usage.webSearches += message.usage.server_tool_use?.web_search_requests ?? 0;

      if (message.stop_reason === "pause_turn" && continuation < MAX_CONTINUATIONS) {
        // Hand the paused turn back unchanged so the server tool can carry on.
        messages.push({ role: "assistant", content: message.content as ContentBlockParam[] });
        continue;
      }

      forward(markers.finish());
      return {
        text,
        stopReason: message.stop_reason,
        model: message.model,
        ttftMs,
        totalMs: performance.now() - started,
        usage,
        aborted: false,
      };
    }
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

/** The search query (or fetched URL) from a server tool input: streamed JSON text or an object. */
export function queryOf(input: unknown): string | null {
  let value: unknown = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const { query, url } = value as { query?: unknown; url?: unknown };
  const found = query ?? url;
  return typeof found === "string" && found.trim() ? found.trim() : null;
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
