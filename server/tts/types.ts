import type { WordTiming } from "../../shared/protocol.js";

export interface SynthResult {
  audio: Buffer;
  mime: string;
  words: WordTiming[];
}
