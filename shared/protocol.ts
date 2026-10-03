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
  | {
      type: "done";
      stopReason: string | null;
      model: string;
      ttftMs: number | null;
      totalMs: number;
      usage: Usage | null;
    }
  | { type: "error"; code: ChatErrorCode; message: string };

export interface HealthResponse {
  ok: boolean;
  model: string;
  effort: string;
  hasKey: boolean;
}
