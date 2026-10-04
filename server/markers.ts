import { isEmotion, isLang, type Emotion, type Lang } from "../shared/protocol.js";

// Claude steers the avatar with markers inside its reply (see persona.md):
// "[[en]]" switches the conversation language, "[[happy]]" etc. set the mood
// from that sentence on. Markers are removed from what is shown and spoken.

export type Marker = { kind: "lang"; lang: Lang } | { kind: "emotion"; emotion: Emotion };
export type Piece = string | Marker;

const LONGEST_NAME = Math.max(..."surprised neutral relaxed happy sad fi en".split(" ").map((n) => n.length));

function toMarker(name: string): Marker | null {
  if (isLang(name)) return { kind: "lang", lang: name };
  if (isEmotion(name)) return { kind: "emotion", emotion: name };
  return null;
}

/** Pulls [[markers]] out of streamed text, even when one is split across deltas. */
export class MarkerFilter {
  private held = "";
  private skipSpace = false;

  /** Feeds a text delta; returns text and markers in order. */
  push(delta: string): Piece[] {
    let text = this.held + delta;
    this.held = "";
    const pieces: Piece[] = [];

    for (;;) {
      if (this.skipSpace) {
        const trimmed = text.replace(/^[ \t]+/, "");
        if (trimmed.length === 0 && text.length > 0) break; // only spaces so far; keep skipping
        this.skipSpace = trimmed.length === 0;
        text = trimmed;
      }
      const open = text.indexOf("[[");
      if (open < 0) {
        // A lone trailing "[" may be the start of a marker.
        const keep = text.endsWith("[") ? 1 : 0;
        pushText(pieces, text.slice(0, text.length - keep));
        this.held = text.slice(text.length - keep);
        break;
      }
      pushText(pieces, text.slice(0, open));
      const rest = text.slice(open + 2);
      const close = rest.indexOf("]]");
      if (close < 0) {
        // Unfinished: hold it while it can still become a marker.
        if (/^[a-z]*\]?$/.test(rest) && rest.length <= LONGEST_NAME + 1) {
          this.held = text.slice(open);
          break;
        }
        pushText(pieces, "[[");
        text = rest;
        continue;
      }
      const marker = toMarker(rest.slice(0, close));
      if (marker) {
        pieces.push(marker);
        this.skipSpace = true; // "[[happy]] Hei" → "Hei"
      } else {
        pushText(pieces, `[[${rest.slice(0, close)}]]`);
      }
      text = rest.slice(close + 2);
    }
    return pieces;
  }

  /** Flushes anything held back when the reply ends. */
  finish(): Piece[] {
    const pieces: Piece[] = [];
    pushText(pieces, this.held);
    this.held = "";
    return pieces;
  }
}

function pushText(pieces: Piece[], text: string): void {
  if (text) pieces.push(text);
}

/** Removes all markers from a stored reply (for transcripts). */
export function stripMarkers(text: string): string {
  return text.replace(/\[\[([a-z]+)\]\][ \t]*/g, (match, name: string) => (toMarker(name) ? "" : match));
}

// Inside the sentence splitter an emotion travels as one private-use character
// at the point where Claude put the marker, so it ends up in the right sentence.
const EMOTION_CHARS: Record<Emotion, string> = {
  neutral: "",
  happy: "",
  sad: "",
  surprised: "",
  relaxed: "",
};
const CHAR_EMOTIONS = new Map(Object.entries(EMOTION_CHARS).map(([emotion, char]) => [char, emotion as Emotion]));
export const EMOTION_CHAR_PATTERN = /[-]/g;

export function emotionChar(emotion: Emotion): string {
  return EMOTION_CHARS[emotion];
}

/** Splits a sentence from the splitter into its text and the (last) emotion marked in it. */
export function takeEmotion(chunk: string): { text: string; emotion: Emotion | null } {
  let emotion: Emotion | null = null;
  const text = chunk.replace(EMOTION_CHAR_PATTERN, (char) => {
    emotion = CHAR_EMOTIONS.get(char) ?? emotion;
    return "";
  });
  return { text: text.replace(/\s+/g, " ").trim(), emotion };
}
