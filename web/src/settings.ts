import { isLang, type Lang, type TtsEngineId, type VoiceOption } from "../../shared/protocol";
import { browserVoices } from "./tts/browser-tts";

/** Push-to-talk (Web Speech) or always-on listening (VAD + local Whisper). */
export type ListenMode = "ptt" | "always";

export interface Settings {
  lang: Lang;
  listenMode: ListenMode;
  engine: TtsEngineId;
  /** Speaking rate change in percent. */
  rate: number;
  /** Chosen voice per engine and language, e.g. "edge:fi" → "fi-FI-NooraNeural". */
  voices: Record<string, string>;
}

const KEY = "avatar.settings";
const ENGINES: readonly TtsEngineId[] = ["edge", "piper", "browser"];

const DEFAULTS: Settings = { lang: "fi", listenMode: "ptt", engine: "edge", rate: 0, voices: {} };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      lang: isLang(stored.lang) ? stored.lang : DEFAULTS.lang,
      listenMode: stored.listenMode === "always" ? "always" : "ptt",
      engine: ENGINES.find((e) => e === stored.engine) ?? DEFAULTS.engine,
      rate: typeof stored.rate === "number" ? stored.rate : DEFAULTS.rate,
      voices: typeof stored.voices === "object" && stored.voices ? stored.voices : {},
    };
  } catch {
    return { ...DEFAULTS, voices: {} };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private window): settings just aren't remembered.
  }
}

/** Voices offered by the server (/api/tts/voices); filled in at startup. */
let serverVoices: VoiceOption[] = [];

export function setServerVoices(voices: VoiceOption[]): void {
  serverVoices = voices;
}

export function isEngineAvailable(engine: TtsEngineId): boolean {
  if (engine === "browser") return "speechSynthesis" in window;
  return serverVoices.some((v) => v.engine === engine);
}

export function voiceOptions(engine: TtsEngineId, lang: Lang): { id: string; label: string }[] {
  if (engine === "browser") return browserVoices(lang).map((v) => ({ id: v.name, label: v.name }));
  return serverVoices.filter((v) => v.engine === engine && v.lang === lang).map(({ id, label }) => ({ id, label }));
}

/** The stored voice if still offered, otherwise the default (first) one. */
export function resolveVoice(settings: Settings, engine: TtsEngineId, lang: Lang): string | null {
  const options = voiceOptions(engine, lang);
  const chosen = settings.voices[`${engine}:${lang}`];
  return options.find((o) => o.id === chosen)?.id ?? options[0]?.id ?? null;
}
