import type { Lang, TtsEngineId } from "../../../shared/protocol";
import { isAbortError } from "../api";
import { resolveVoice, type Settings } from "../settings";
import { BrowserTts } from "./browser-tts";
import type { Clip, TtsEngine } from "./engine";
import { ServerTts } from "./server-tts";

/**
 * Picks the engine from the settings and falls back to the browser's own
 * voice when the server engine fails (e.g. the unofficial Edge endpoint changed).
 */
export class Speaker {
  private readonly engines: Record<TtsEngineId, TtsEngine> = {
    edge: new ServerTts("edge"),
    piper: new ServerTts("piper"),
    browser: new BrowserTts(),
  };

  constructor(
    private readonly getSettings: () => Settings,
    private readonly onFallback: (from: TtsEngineId, error: unknown) => void,
  ) {}

  async prepare(text: string, lang: Lang, signal: AbortSignal): Promise<Clip> {
    const settings = this.getSettings();
    const engineId = settings.engine;
    const options = { lang, rate: settings.rate, signal };
    try {
      return await this.engines[engineId].prepare(text, {
        ...options,
        voice: resolveVoice(settings, engineId, lang),
      });
    } catch (err) {
      if (isAbortError(err) || engineId === "browser") throw err;
      this.onFallback(engineId, err);
      return this.engines.browser.prepare(text, { ...options, voice: resolveVoice(settings, "browser", lang) });
    }
  }
}
