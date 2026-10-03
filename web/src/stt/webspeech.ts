// Push-to-talk speech recognition with the browser's Web Speech API
// (Edge and Chrome; audio is recognized in the vendor's cloud).

// Minimal typings: the Web Speech API is not in every TypeScript DOM lib.
interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent extends Event {
  readonly results: RecognitionResultList;
}
interface RecognitionErrorEvent extends Event {
  readonly error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SttHandlers {
  onInterim(text: string): void;
  /** Called once per start(), after stop(); empty string when nothing was heard. */
  onFinal(text: string): void;
  onError(code: string): void;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export class WebSpeechStt {
  static isSupported(): boolean {
    return getRecognitionCtor() !== null;
  }

  private recognition: Recognition | null = null;
  private finalText = "";
  private interimText = "";

  constructor(private readonly handlers: SttHandlers) {}

  get active(): boolean {
    return this.recognition !== null;
  }

  start(lang: string): void {
    if (this.recognition) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this.handlers.onError("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.finalText = "";
    this.interimText = "";

    rec.onresult = (event) => {
      // Rebuild from all results: robust against engines re-reporting segments.
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) final += ` ${transcript}`;
        else interim += ` ${transcript}`;
      }
      this.finalText = final;
      this.interimText = interim;
      this.handlers.onInterim(tidy(final + interim));
    };
    rec.onerror = (event) => {
      // "aborted" comes from cancel(); "no-speech" is reported as an empty onFinal.
      if (event.error !== "aborted" && event.error !== "no-speech") this.handlers.onError(event.error);
    };
    rec.onend = () => {
      if (this.recognition !== rec) return;
      this.recognition = null;
      // Include the last interim words: the key is often released before they finalize.
      this.handlers.onFinal(tidy(this.finalText + this.interimText));
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      this.recognition = null;
      this.handlers.onError("start-failed");
    }
  }

  /** Stops listening; the transcript arrives through onFinal. */
  stop(): void {
    this.recognition?.stop();
  }

  /** Stops listening and discards the transcript. */
  cancel(): void {
    const rec = this.recognition;
    this.recognition = null;
    rec?.abort();
  }
}
