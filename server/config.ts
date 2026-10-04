export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

function parseEffort(value: string | undefined): Effort {
  const v = value?.trim().toLowerCase();
  return EFFORTS.find((e) => e === v) ?? "low";
}

export type WebSearchMode = "fast" | "thorough" | "off";

function parseWebSearch(value: string | undefined): WebSearchMode {
  const v = value?.trim().toLowerCase();
  return v === "off" || v === "thorough" ? v : "fast";
}

// Variables are prefixed with AVATAR_ because Node's --env-file never overrides
// variables already set in the shell, and generic names (PORT, CLAUDE_*) are
// often set by other tools.
export const config = {
  port: Number(process.env.AVATAR_PORT || 3001),
  model: process.env.AVATAR_MODEL?.trim() || "claude-opus-5-5",
  effort: parseEffort(process.env.AVATAR_EFFORT),
  // Spoken replies are short; this only caps runaway output (thinking included).
  maxTokens: 4096,
  // Optional offline voice: python -m piper.http_server (see README).
  piperUrl: (process.env.AVATAR_PIPER_URL || "http://127.0.0.1:5000").replace(/\/+$/, ""),
  // Claude's server-side web search (billed per search on top of tokens):
  // "fast" = plain search (default), "thorough" = results filtered by code
  // first (better on messy pages but noticeably slower), "off".
  webSearch: parseWebSearch(process.env.AVATAR_WEB_SEARCH),
  webSearchMaxUses: 3,
  // Approximate location, so "tomorrow's weather" finds local results.
  location: {
    type: "approximate" as const,
    country: process.env.AVATAR_COUNTRY || "FI",
    timezone: process.env.AVATAR_TIMEZONE || "Europe/Helsinki",
    ...(process.env.AVATAR_CITY ? { city: process.env.AVATAR_CITY } : {}),
  },
  // Where memory.json lives (tests point this elsewhere so they never touch real memory).
  dataDir: process.env.AVATAR_DATA_DIR || "data",
  // Local speech recognition for always-on listening (scripts/whisper.mjs starts it).
  whisperUrl: (process.env.AVATAR_WHISPER_URL || `http://127.0.0.1:${process.env.AVATAR_WHISPER_PORT || 8178}`).replace(
    /\/+$/,
    "",
  ),
};
