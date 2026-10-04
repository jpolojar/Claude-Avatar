import type { Emotion } from "../../../shared/protocol";
import { isAbortError } from "../api";
import type { Clip } from "./engine";

export interface QueueHooks {
  /** A clip starts playing; index counts clips actually played. emotion is set when the mood changes here. */
  onClipStart(clip: Clip, index: number, emotion: Emotion | undefined): void;
  onClipEnd(): void;
  /** Synthesis failed for a sentence (it is skipped). */
  onError(error: unknown): void;
}

/** Sentences synthesized ahead of the one playing (at most two requests in flight). */
const LOOKAHEAD = 1;

interface Pending {
  text: string;
  emotion: Emotion | undefined;
}

interface Prepared {
  clip: Clip;
  emotion: Emotion | undefined;
}

/**
 * Speaks sentences in order as they arrive. The next sentences are
 * synthesized while the current one plays, so speech starts with the first
 * sentence and continues without waiting for the rest of the reply.
 */
export class SpeechQueue {
  private readonly pending: Pending[] = [];
  private readonly preparing: Promise<Prepared | null>[] = [];
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

  push(text: string, emotion?: Emotion): void {
    if (this.closed || this.signal.aborted) return;
    this.pending.push({ text, emotion });
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
      const { text, emotion } = this.pending.shift()!;
      this.preparing.push(
        this.prepare(text, this.signal).then(
          (clip) => ({ clip, emotion }),
          (err: unknown) => {
            if (!isAbortError(err)) this.hooks.onError(err);
            return null;
          },
        ),
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
      const prepared = await next;
      if (!prepared || this.signal.aborted) continue;
      this.hooks.onClipStart(prepared.clip, index++, prepared.emotion);
      try {
        const result = await prepared.clip.play(this.signal);
        if (result.spokenText) this.heard.push(result.spokenText);
      } finally {
        this.hooks.onClipEnd();
      }
    }
  }
}
