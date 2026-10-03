export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

function parseEffort(value: string | undefined): Effort {
  const v = value?.trim().toLowerCase();
  return EFFORTS.find((e) => e === v) ?? "low";
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
};
