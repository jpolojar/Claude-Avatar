import type { Lang } from "../shared/protocol.js";

// Claude switches the conversation language by starting its reply with
// "[[en]]" or "[[fi]]" (see persona.md). The marker is stripped from what the
// browser shows and speaks, and turned into a language-change event.
const MARKER = /^\s*\[\[(fi|en)\]\]\s*/;
const LONGEST_MARKER = "  [[fi]] ".length;

export class LanguageMarkerFilter {
  private head = "";
  private decided = false;

  /** Feeds a text delta; returns the text to forward (possibly empty) and any language switch. */
  push(delta: string): { text: string; lang?: Lang } {
    if (this.decided) return { text: delta };
    this.head += delta;
    const match = MARKER.exec(this.head);
    if (match) {
      // Wait for the whitespace after the marker before deciding, unless more text already followed.
      if (match[0].length === this.head.length && this.head.length < LONGEST_MARKER) return { text: "" };
      this.decided = true;
      return { text: this.head.slice(match[0].length), lang: match[1] as Lang };
    }
    if (couldStillBeMarker(this.head)) return { text: "" };
    this.decided = true;
    return { text: this.head };
  }

  /** Flushes whatever was held back when the reply ends. */
  finish(): { text: string; lang?: Lang } {
    if (this.decided) return { text: "" };
    this.decided = true;
    const match = MARKER.exec(this.head);
    return match ? { text: "", lang: match[1] as Lang } : { text: this.head };
  }
}

function couldStillBeMarker(head: string): boolean {
  const trimmed = head.trimStart();
  return ["[[fi]]", "[[en]]"].some((m) => m.startsWith(trimmed)) && head.length < LONGEST_MARKER;
}
