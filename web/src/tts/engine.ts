import type { Lang, TtsEngineId, WordTiming } from "../../../shared/protocol";

export interface PlayResult {
  /** False when playback was cut off by the abort signal. */
  completed: boolean;
  /** The part of the text that was actually heard (all of it when completed). */
  spokenText: string;
}

/** Synthesized speech, ready to play. Preparing and playing are separate so
 *  the next sentence can be synthesized while the current one plays. */
export interface Clip {
  readonly engine: TtsEngineId;
  readonly voice: string | null;
  readonly text: string;
  /** Time spent synthesizing, for the debug line. */
  readonly prepareMs: number;
  /** Word timings for lip sync (empty when the engine has none). */
  readonly words: readonly WordTiming[];
  /** Plays to the end; resolves early, after a short fade, when the signal aborts. */
  play(signal: AbortSignal): Promise<PlayResult>;
}

export interface PrepareOptions {
  lang: Lang;
  voice: string | null;
  /** Rate change in percent (0 = normal). */
  rate: number;
  signal: AbortSignal;
}

export interface TtsEngine {
  readonly id: TtsEngineId;
  prepare(text: string, options: PrepareOptions): Promise<Clip>;
}

/**
 * The beginning of `text` heard after `playedMs` of playback: up to the end of
 * the last word that had started, located through the word timings. Without
 * timings the played fraction of the duration is used instead.
 */
export function spokenPrefix(
  text: string,
  words: readonly WordTiming[],
  playedMs: number,
  durationMs: number,
): string {
  if (words.length > 0) {
    let cursor = 0;
    let end = 0;
    for (const word of words) {
      if (word.offsetMs > playedMs) break;
      const at = text.indexOf(word.text, cursor);
      if (at < 0) continue; // e.g. an escaped "&amp;": skip, keep the cursor
      cursor = at + word.text.length;
      end = cursor;
    }
    return text.slice(0, end).trim();
  }
  if (durationMs <= 0) return "";
  const cut = Math.round(text.length * Math.min(1, playedMs / durationMs));
  const space = text.lastIndexOf(" ", cut);
  return text.slice(0, space > 0 ? space : 0).trim();
}
