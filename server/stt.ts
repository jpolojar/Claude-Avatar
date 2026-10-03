// Speech to text with a local whisper.cpp server (used by always-on listening;
// push-to-talk uses the browser's Web Speech API instead).
import type { Lang } from "../shared/protocol.js";
import { config } from "./config.js";

export async function whisperAvailable(): Promise<boolean> {
  try {
    const res = await fetch(config.whisperUrl, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

// Whisper "hears" these in silence or noise (it was trained on subtitled video).
const HALLUCINATIONS = [
  /^kiitos (katsomisesta|kuuntelemisesta)/i,
  /^tekstitys/i,
  /^thanks? (you )?for watching/i,
  /^subtitles? by/i,
  /^\[.*\]$/,
  /^\(.*\)$/,
];

export function cleanTranscript(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.some((pattern) => pattern.test(cleaned)) ? "" : cleaned;
}

export async function transcribe(wav: Buffer, lang: Lang): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");
  form.append("language", lang);
  form.append("response_format", "json");
  form.append("temperature", "0");
  const res = await fetch(`${config.whisperUrl}/inference`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`whisper HTTP ${res.status}`);
  const body = (await res.json()) as { text?: string; error?: string };
  if (body.error) throw new Error(`whisper: ${body.error}`);
  return cleanTranscript(body.text ?? "");
}
