// Shared set-up for the web page (main.ts) and the desktop widget (widget/).
import type { TtsEngineId } from "../../shared/protocol";
import { fetchVoices } from "./api";
import { loadSettings, saveSettings, setServerVoices, type Settings } from "./settings";
import { waitForBrowserVoices } from "./tts/browser-tts";
import { Speaker } from "./tts/speaker";
import { strings } from "./ui/strings";

export interface SettingsStore {
  get(): Settings;
  update(patch: Partial<Settings>): void;
  /** Reloads from storage (another window of the app changed the settings). */
  reload(): void;
}

export function createSettingsStore(): SettingsStore {
  let settings = loadSettings();
  return {
    get: () => settings,
    update: (patch) => {
      settings = { ...settings, ...patch };
      saveSettings(settings);
    },
    reload: () => {
      settings = loadSettings();
    },
  };
}

/** The speech engine chooser; a failing server voice is reported once, not per sentence. */
export function createSpeaker(store: SettingsStore, showNotice: (text: string) => void): Speaker {
  const reported = new Set<TtsEngineId>();
  return new Speaker(store.get, (from, error) => {
    console.warn(`TTS engine ${from} failed, using the browser voice`, error);
    if (reported.has(from)) return;
    reported.add(from);
    showNotice(strings.ttsFallback(from));
  });
}

/** Loads the server's voice list; the server may still be starting, so keep asking. */
export function keepLoadingVoices(onLoaded: () => void): void {
  const load = async () => {
    const [voices] = await Promise.all([fetchVoices(), waitForBrowserVoices()]);
    setServerVoices(voices);
    onLoaded();
    if (voices.length === 0) setTimeout(load, 3000);
  };
  void load();
}
