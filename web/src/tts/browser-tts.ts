// Fallback: the browser's own speechSynthesis (Edge has free "Online (Natural)"
// voices such as Noora). The audio bypasses Web Audio, so it cannot drive
// amplitude lip sync or be removed by the echo canceller.
import type { Lang } from "../../../shared/protocol";
import type { Clip, PlayResult, PrepareOptions, TtsEngine } from "./engine";

const LOCALES: Record<Lang, string> = { fi: "fi-FI", en: "en-US" };

let voicesReady: Promise<void> | null = null;

/** speechSynthesis loads its voice list asynchronously; wait for it (briefly). */
export function waitForBrowserVoices(): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  voicesReady ??= new Promise((resolve) => {
    if (speechSynthesis.getVoices().length > 0) return resolve();
    const done = () => resolve();
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
  return voicesReady;
}

/** Voices for a language, natural (neural) voices first. */
export function browserVoices(lang: Lang): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  const prefix = LOCALES[lang].slice(0, 2);
  const score = (v: SpeechSynthesisVoice) =>
    (/natural/i.test(v.name) ? 2 : 0) + (v.lang.replace("_", "-") === LOCALES[lang] ? 1 : 0);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(prefix))
    .sort((a, b) => score(b) - score(a));
}

export class BrowserTts implements TtsEngine {
  readonly id = "browser" as const;

  async prepare(text: string, { lang, voice, rate }: PrepareOptions): Promise<Clip> {
    if (!("speechSynthesis" in window)) throw new Error("speechSynthesis not supported");
    await waitForBrowserVoices();
    const voices = browserVoices(lang);
    const chosen = voices.find((v) => v.name === voice) ?? voices[0] ?? null;

    return {
      engine: this.id,
      voice: chosen?.name ?? null,
      text,
      prepareMs: 0,
      words: [],
      play: (signal) =>
        new Promise<PlayResult>((resolve) => {
          if (signal.aborted) return resolve({ completed: false, spokenText: "" });
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = LOCALES[lang];
          if (chosen) utterance.voice = chosen;
          utterance.rate = 1 + rate / 100;
          // Word boundary events tell how far the voice got before an interruption.
          let spokenEnd = 0;
          utterance.onboundary = (event) => {
            const wordEnd = text.indexOf(" ", event.charIndex);
            spokenEnd = event.charLength ? event.charIndex + event.charLength : wordEnd < 0 ? text.length : wordEnd;
          };
          const finish = (completed: boolean) => {
            signal.removeEventListener("abort", onAbort);
            resolve({ completed, spokenText: completed ? text : text.slice(0, spokenEnd).trim() });
          };
          const onAbort = () => {
            speechSynthesis.cancel();
            finish(false);
          };
          utterance.onend = () => finish(true);
          utterance.onerror = () => finish(false);
          signal.addEventListener("abort", onAbort, { once: true });
          speechSynthesis.cancel(); // drop anything stale still queued
          speechSynthesis.speak(utterance);
        }),
    };
  }
}
