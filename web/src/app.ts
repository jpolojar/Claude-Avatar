import type { ChatEvent, Lang, TtsEngineId } from "../../shared/protocol";
import { isAbortError, streamChat } from "./api";
import type { Settings } from "./settings";
import { WebSpeechStt } from "./stt/webspeech";
import type { Clip } from "./tts/engine";
import type { Speaker } from "./tts/speaker";
import type { ChatLog } from "./ui/chat-log";
import { strings } from "./ui/strings";

export type AppState = "idle" | "listening" | "thinking" | "speaking";

/** What the app needs from the page; implemented with plain DOM in main.ts. */
export interface AppView {
  log: ChatLog;
  setState(state: AppState): void;
  setInterim(text: string): void;
  setDebug(text: string): void;
  showNotice(text: string | null): void;
  /** Claude switched the conversation language; update the settings and the UI. */
  setLanguage(lang: Lang): void;
  /** Speech started (with the engine that plays it) or ended (null); drives lip sync. */
  setSpeaking(engine: TtsEngineId | null): void;
}

type DoneEvent = Extract<ChatEvent, { type: "done" }>;

/** Latency of one turn, measured from sending the text; shown on the status line. */
interface TurnTimings {
  sttMs: number | null;
  firstTextMs: number | null;
  audioStartMs: number | null;
  ttsMs: number | null;
  engine: TtsEngineId | null;
  done: DoneEvent | null;
}

const STT_LANG: Record<Lang, string> = { fi: "fi-FI", en: "en-US" };

export class App {
  private state: AppState = "idle";
  private sessionId = crypto.randomUUID();
  private current: AbortController | null = null;
  private releasedAt: number | null = null;
  private sttError: string | null = null;
  private readonly stt: WebSpeechStt;

  constructor(
    private readonly view: AppView,
    private readonly settings: () => Settings,
    private readonly speaker: Speaker,
  ) {
    this.stt = new WebSpeechStt({
      onInterim: (text) => this.view.setInterim(text),
      onFinal: (text) => this.onTranscript(text),
      onError: (code) => this.onSttError(code),
    });
  }

  private get lang(): Lang {
    return this.settings().lang;
  }

  /** Push-to-talk pressed: cut off any reply in progress and start listening. */
  startListening(): void {
    if (this.state === "listening") return;
    this.interrupt();
    this.releasedAt = null;
    this.sttError = null;
    this.view.showNotice(null);
    this.view.setInterim("");
    this.setState("listening");
    this.stt.start(STT_LANG[this.lang]);
  }

  /** Push-to-talk released: the transcript arrives through onTranscript. */
  stopListening(): void {
    if (this.state !== "listening") return;
    this.releasedAt = performance.now();
    this.stt.stop();
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.stop();
    this.view.showNotice(null);
    void this.send(trimmed, null);
  }

  /** Speaks a line without asking Claude (voice test). */
  say(text: string): void {
    this.stop();
    const controller = this.beginTurn();
    void this.speak(text, this.lang, controller)
      .catch(() => {})
      .finally(() => this.endTurn(controller));
  }

  /** Stops listening and any reply or speech in progress. */
  stop(): void {
    this.stt.cancel();
    this.interrupt();
    this.setState("idle");
  }

  newConversation(): void {
    this.stop();
    this.sessionId = crypto.randomUUID();
    this.view.log.clear();
    this.view.setInterim("");
    this.view.setDebug("");
  }

  private interrupt(): void {
    this.current?.abort();
    this.current = null;
  }

  private beginTurn(): AbortController {
    const controller = new AbortController();
    this.current = controller;
    this.setState("thinking");
    return controller;
  }

  private endTurn(controller: AbortController): void {
    if (this.current !== controller) return;
    this.current = null;
    this.setState("idle");
  }

  private onTranscript(text: string): void {
    this.view.setInterim("");
    if (this.state !== "listening") return;
    if (!text) {
      this.setState("idle");
      if (!this.sttError) this.view.showNotice(strings.noSpeech);
      return;
    }
    const sttMs = this.releasedAt === null ? null : performance.now() - this.releasedAt;
    void this.send(text, sttMs);
  }

  private onSttError(code: string): void {
    this.sttError = code;
    this.view.showNotice(strings.sttErrors[code] ?? strings.sttErrorFallback(code));
    // Failures before recognition started produce no onFinal; reset here.
    if (!this.stt.active && this.state === "listening") this.setState("idle");
  }

  private async send(text: string, sttMs: number | null): Promise<void> {
    let lang = this.lang;
    this.view.log.addUser(text);
    const bubble = this.view.log.addAssistant();
    const controller = this.beginTurn();

    const sentAt = performance.now();
    const timings: TurnTimings = {
      sttMs,
      firstTextMs: null,
      audioStartMs: null,
      ttsMs: null,
      engine: null,
      done: null,
    };
    const showTimings = () => this.view.setDebug(formatDebug(timings));
    let reply = "";
    let failed = false;

    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case "delta":
          timings.firstTextMs ??= performance.now() - sentAt;
          reply += event.text;
          bubble.append(event.text);
          break;
        case "reset":
          reply = "";
          bubble.set("");
          break;
        case "lang":
          // Speak this reply, and listen from now on, in the new language.
          lang = event.lang;
          this.view.setLanguage(lang);
          break;
        case "done":
          timings.done = event;
          if (event.stopReason === "refusal") {
            reply = strings.refusalSpoken[lang];
            bubble.set(strings.refusal);
          } else if (event.stopReason === "max_tokens") {
            bubble.note(strings.truncated);
          }
          showTimings();
          break;
        case "error":
          failed = true;
          bubble.error(strings.chatErrors[event.code]);
          break;
      }
    };

    try {
      await streamChat({ sessionId: this.sessionId, text, lang }, onEvent, controller.signal);
      // Phase b: the whole reply is spoken once it is complete.
      if (!failed && reply.trim()) {
        await this.speak(reply, lang, controller, (clip) => {
          timings.audioStartMs = performance.now() - sentAt;
          timings.ttsMs = clip.prepareMs;
          timings.engine = clip.engine;
          showTimings();
        });
      }
      if (controller.signal.aborted) bubble.note(strings.interrupted);
    } catch (err) {
      if (isAbortError(err)) bubble.note(strings.interrupted);
      else bubble.error(strings.serverDown);
    } finally {
      this.endTurn(controller);
    }
  }

  /** Synthesizes and plays text. A TTS failure is reported but does not fail the turn. */
  private async speak(
    text: string,
    lang: Lang,
    controller: AbortController,
    onStart?: (clip: Clip) => void,
  ): Promise<void> {
    let clip: Clip;
    try {
      clip = await this.speaker.prepare(text, lang, controller.signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      this.view.showNotice(strings.ttsFailed);
      return;
    }
    if (controller.signal.aborted) return;
    if (this.current === controller) this.setState("speaking");
    onStart?.(clip);
    this.view.setSpeaking(clip.engine);
    try {
      await clip.play(controller.signal);
    } finally {
      this.view.setSpeaking(null);
    }
  }

  private setState(state: AppState): void {
    this.state = state;
    this.view.setState(state);
  }
}

function formatDebug(t: TurnTimings): string {
  const ms = (v: number | null) => (v === null ? "–" : `${Math.round(v)} ms`);
  const d = strings.debug;
  const usage = t.done?.usage;
  const parts = [
    t.sttMs !== null ? `${d.stt} ${ms(t.sttMs)}` : null,
    `${d.firstWord} ${ms(t.firstTextMs)}`,
    t.audioStartMs !== null ? `${d.audioStart} ${ms(t.audioStartMs)} (${d.tts} ${ms(t.ttsMs)}, ${t.engine})` : null,
    usage ? `${d.tokens} ${usage.inputTokens}→${usage.outputTokens} · ${d.cache} ${usage.cacheReadTokens}` : null,
    t.done?.model ?? null,
  ];
  return parts.filter(Boolean).join(" · ");
}
