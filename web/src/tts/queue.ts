import { isAbortError } from "../api";
import type { Clip } from "./engine";

export interface QueueHooks {
  /** A clip starts playing; index counts clips actually played. */
  onClipStart(clip: Clip, index: number): void;
  onClipEnd(): void;
  /** Synthesis failed for a sentence (it is skipped). */
  onError(error: unknown): void;
}

/** Sentences synthesized ahead of the one playing (at most two requests in flight). */
const LOOKAHEAD = 1;

/**
 * Speaks sentences in order as they arrive. The next sentences are
 * synthesized while the current one plays, so speech starts with the first
 * sentence and continues without waiting for the rest of the reply.
 */
export class SpeechQueue {
  private readonly pending: string[] = [];
  private readonly preparing: Promise<Clip | null>[] = [];
  private readonly heard: string[] = [];
  private closed = false;
  private wake: (() => void) | null = null;
  /** Resolves when everything pushed before close() has been spoken (or the signal aborted). */
  readonly done: Promise<void>;

  constructor(
    private readonly prepare: (text: string, signal: AbortSignal) => Promise<Clip>,
    private readonly signal: AbortSignal,
    private readonly hooks: QueueHooks,
  ) {
    signal.addEventListener("abort", () => this.wake?.(), { once: true });
    this.done = this.run();
  }

  push(text: string): void {
    if (this.closed || this.signal.aborted) return;
    this.pending.push(text);
    this.fill();
    this.wake?.();
  }

  /** What has actually been heard so far, including a sentence cut off midway. */
  get spokenText(): string {
    return this.heard.join(" ");
  }

  /** No more sentences will come. */
  close(): void {
    this.closed = true;
    this.wake?.();
  }

  private fill(): void {
    while (this.preparing.length < LOOKAHEAD && this.pending.length > 0) {
      const text = this.pending.shift()!;
      this.preparing.push(
        this.prepare(text, this.signal).catch((err: unknown) => {
          if (!isAbortError(err)) this.hooks.onError(err);
          return null;
        }),
      );
    }
  }

  private async run(): Promise<void> {
    let index = 0;
    while (!this.signal.aborted) {
      const next = this.preparing.shift();
      if (!next) {
        if (this.closed && this.pending.length === 0) return;
        await new Promise<void>((resolve) => (this.wake = resolve));
        this.wake = null;
        continue;
      }
      this.fill(); // start synthesizing the following sentence while this one plays
      const clip = await next;
      if (!clip || this.signal.aborted) continue;
      this.hooks.onClipStart(clip, index++);
      try {
        const result = await clip.play(this.signal);
        if (result.spokenText) this.heard.push(result.spokenText);
      } finally {
        this.hooks.onClipEnd();
      }
    }
  }
}
