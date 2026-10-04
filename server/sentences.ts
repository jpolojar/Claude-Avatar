// Splits streamed reply text into speakable chunks as soon as they are
// complete, so speech can start before Claude has finished writing.

// Abbreviations that end with a dot but do not end a sentence (lowercase,
// including the dot). Finnish first, then English.
const ABBREVIATIONS = new Set([
  "esim.", "ns.", "mm.", "jne.", "yms.", "tms.", "ym.", "ks.", "vrt.", "n.", "ca.", "klo.", "s.", "ts.",
  "huom.", "prof.", "tri.", "ry.", "mrd.", "milj.", "kpl.", "v.", "vs.", "jms.", "em.", "eaa.", "jaa.", "mr.",
  "e.g.", "i.e.", "etc.", "mrs.", "ms.", "dr.", "st.", "jr.", "sr.", "approx.", "no.", "inc.", "ltd.",
]);

const TERMINATORS = ".!?…";
const CLOSERS = `.!?…"'”’)»`;
// Emotion marks (see markers.ts) sit at the start of the sentence they apply to.
const OPENERS = `"“'‘(«`;
const TRAILING_MARKS = /[\s-]*$/;

/** A chunk longer than this is cut at a comma, colon or dash instead. */
const SOFT_LIMIT = 160;
/** The first chunk is cut earlier so the avatar starts talking sooner. */
const FIRST_SOFT_LIMIT = 80;
/** Never cut a chunk shorter than this at a soft boundary. */
const MIN_SOFT_CHUNK = 25;
/** Without any punctuation, cut at a space after this many characters. */
const HARD_LIMIT = 300;

export class SentenceSplitter {
  private buffer = "";
  private emitted = 0;

  /** Feeds streamed text; returns the chunks completed by it. */
  push(text: string): string[] {
    this.buffer += text;
    const chunks: string[] = [];
    for (;;) {
      const end = findSentenceEnd(this.buffer) ?? this.softEnd();
      if (end === null) break;
      this.emit(chunks, end);
    }
    return chunks;
  }

  /**
   * The buffered text, if it already looks like a finished sentence. Used when
   * the stream pauses: instead of waiting for the next word to confirm the
   * boundary, speak what is there.
   */
  flushIfComplete(): string[] {
    // An emotion mark after the sentence belongs to the next one: leave it buffered.
    const body = this.buffer.slice(0, TRAILING_MARKS.exec(this.buffer)!.index);
    if (!looksComplete(body)) return [];
    const chunks: string[] = [];
    this.emit(chunks, body.length);
    return chunks;
  }

  /** Returns whatever is left when the reply ends. */
  flush(): string[] {
    const chunks: string[] = [];
    this.emit(chunks, this.buffer.length);
    return chunks;
  }

  private emit(chunks: string[], end: number): void {
    const chunk = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end).trimStart();
    if (chunk) {
      chunks.push(chunk);
      this.emitted++;
    }
  }

  private softEnd(): number | null {
    const limit = this.emitted === 0 ? FIRST_SOFT_LIMIT : SOFT_LIMIT;
    if (this.buffer.length <= limit) return null;
    const soft = /[,;:](?=\s)|\s[–—-](?=\s)/g;
    let cut: number | null = null;
    for (const match of this.buffer.matchAll(soft)) {
      const end = match.index + match[0].length;
      if (end >= MIN_SOFT_CHUNK) cut = end;
    }
    if (cut !== null) return cut;
    if (this.buffer.length > HARD_LIMIT) {
      const space = this.buffer.lastIndexOf(" ", HARD_LIMIT);
      return space > MIN_SOFT_CHUNK ? space : HARD_LIMIT;
    }
    return null;
  }
}

/**
 * End index (exclusive) of the first complete sentence, or null if none is
 * certain yet. A terminator only ends a sentence when whitespace and then an
 * uppercase letter, digit or opening quote follow, so the next character must
 * already have arrived.
 */
export function findSentenceEnd(text: string): number | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      if (text.slice(0, i).trim()) return i + 1;
      continue;
    }
    if (!TERMINATORS.includes(ch)) continue;

    let end = i + 1;
    while (end < text.length && CLOSERS.includes(text[end]!)) end++;
    let next = end;
    while (next < text.length && /\s/.test(text[next]!)) next++;
    if (next === end) {
      if (end === text.length) return null; // the next character hasn't arrived yet
      i = end - 1;
      continue; // "3.10." or "1.5": no space after the dot
    }
    if (next === text.length) return null; // whitespace so far; wait for the next word

    const following = text[next]!;
    const startsSentence = /\p{Lu}|\d/u.test(following) || OPENERS.includes(following);
    if (startsSentence && !(ch === "." && isAbbreviation(text, i))) return end;
    i = end - 1;
  }
  return null;
}

/** Ends with . ! ? or … (plus closing quotes) that cannot be an abbreviation, initial or number. */
function looksComplete(text: string): boolean {
  let end = text.length;
  while (end > 0 && `"'”’)»`.includes(text[end - 1]!)) end--;
  const last = text[end - 1];
  if (!last || !TERMINATORS.includes(last)) return false;
  if (last !== ".") return true;
  let dot = end - 1;
  while (dot > 0 && text[dot - 1] === ".") dot--; // "..." is an ellipsis
  if (dot < end - 1) return true;
  return !/\d/.test(text[dot - 1] ?? "") && !isAbbreviation(text, dot);
}

/** True when the dot at `dot` ends an abbreviation or an initial ("J. K."). */
function isAbbreviation(text: string, dot: number): boolean {
  let start = dot;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  const word = text.slice(start, dot + 1).toLowerCase().replace(/^[("'“‘«]+/, "");
  return ABBREVIATIONS.has(word) || /^\p{L}\.$/u.test(word);
}
