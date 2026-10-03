import type { Lang, TtsEngineId, WordTiming } from "../../../shared/protocol";

/** Synthesized speech, ready to play. Preparing and playing are separate so
 *  the next sentence can be synthesized while the current one plays. */
export interface Clip {
  readonly engine: TtsEngineId;
  readonly voice: string | null;
  /** Time spent synthesizing, for the debug line. */
  readonly prepareMs: number;
  /** Word timings for lip sync (empty when the engine has none). */
  readonly words: readonly WordTiming[];
  /** Plays to the end; resolves early, after a short fade, when the signal aborts. */
  play(signal: AbortSignal): Promise<void>;
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
