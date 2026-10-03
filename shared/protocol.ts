// Wire format shared by the Node server and the browser client.

export type Lang = "fi" | "en";

export const LANGS: readonly Lang[] = ["fi", "en"];

export function isLang(value: unknown): value is Lang {
  return value === "fi" || value === "en";
}

export interface ChatRequest {
  sessionId: string;
  text: string;
  lang: Lang;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type ChatErrorCode = "auth" | "rate_limit" | "overloaded" | "network" | "bad_request" | "api";

// /api/chat streams one JSON object per line (NDJSON).
export type ChatEvent =
  | { type: "delta"; text: string }
  // A server-side fallback discarded the partial reply; clear what was shown so far.
  | { type: "reset" }
  // Claude switched the conversation language (the user asked for it by voice).
  | { type: "lang"; lang: Lang }
  // A complete, speakable chunk of the reply (also contained in the deltas).
  | { type: "sentence"; index: number; text: string }
  | {
      type: "done";
      stopReason: string | null;
      model: string;
      ttftMs: number | null;
      totalMs: number;
      usage: Usage | null;
    }
  | { type: "error"; code: ChatErrorCode; message: string };

// --- Text to speech -------------------------------------------------------

/** Server-side engines; "browser" (speechSynthesis) runs entirely in the page. */
export type ServerTtsEngine = "edge" | "piper";
export type TtsEngineId = ServerTtsEngine | "browser";

export function isServerTtsEngine(value: unknown): value is ServerTtsEngine {
  return value === "edge" || value === "piper";
}

export interface VoiceOption {
  id: string;
  label: string;
  lang: Lang;
  engine: ServerTtsEngine;
}

export interface TtsRequest {
  text: string;
  engine: ServerTtsEngine;
  voice: string;
  /** Speaking rate change in percent, e.g. -10 or 15. */
  rate: number;
}

export interface WordTiming {
  text: string;
  offsetMs: number;
  durationMs: number;
}

export interface TtsResponse {
  mime: string;
  /** Base64-encoded audio file (MP3 from edge, WAV from Piper). */
  audio: string;
  /** Word timings for lip sync; empty when the engine has none. */
  words: WordTiming[];
  synthMs: number;
}

export interface HealthResponse {
  ok: boolean;
  model: string;
  effort: string;
  hasKey: boolean;
}
