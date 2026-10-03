import type { TtsRequest, TtsResponse, VoiceOption } from "../../shared/protocol.js";
import { config } from "../config.js";
import { synthesizeEdge } from "./edge.js";
import { piperAvailable, synthesizePiper } from "./piper.js";

// Curated female voices; the first voice per language is the default.
// The multilingual Ava keeps one voice identity across both languages.
const EDGE_VOICES: VoiceOption[] = [
  { id: "fi-FI-NooraNeural", label: "Noora", lang: "fi", engine: "edge" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava (monikielinen)", lang: "fi", engine: "edge" },
  { id: "en-US-AvaNeural", label: "Ava", lang: "en", engine: "edge" },
  { id: "en-US-EmmaNeural", label: "Emma", lang: "en", engine: "edge" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava (monikielinen)", lang: "en", engine: "edge" },
];

const PIPER_VOICE: VoiceOption = {
  id: "fi_FI-harri-medium",
  label: "Harri (offline, miesääni)",
  lang: "fi",
  engine: "piper",
};

export const MAX_TTS_CHARS = 2000;
export const MAX_RATE = 50;

export async function listVoices(): Promise<VoiceOption[]> {
  return (await piperAvailable(config.piperUrl)) ? [...EDGE_VOICES, PIPER_VOICE] : EDGE_VOICES;
}

/** True for voices this server offers; the voice id ends up inside SSML. */
export function isKnownVoice(engine: TtsRequest["engine"], voice: string): boolean {
  if (engine === "piper") return voice === PIPER_VOICE.id;
  return EDGE_VOICES.some((v) => v.id === voice);
}

/** Strips things a speech engine would read out literally. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[*_#`~|<>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function synthesize(request: TtsRequest): Promise<TtsResponse> {
  const started = performance.now();
  const text = cleanForSpeech(request.text);
  const rate = Math.max(-MAX_RATE, Math.min(MAX_RATE, Math.round(request.rate)));
  const result =
    request.engine === "piper"
      ? await synthesizePiper(config.piperUrl, text, rate)
      : await synthesizeEdge(text, request.voice, rate);
  return {
    mime: result.mime,
    audio: result.audio.toString("base64"),
    words: result.words,
    synthMs: performance.now() - started,
  };
}
