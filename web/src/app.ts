import type { ChatEvent, Lang } from "../../shared/protocol";
import { isAbortError, streamChat } from "./api";
import { WebSpeechStt } from "./stt/webspeech";
import type { AssistantBubble, ChatLog } from "./ui/chat-log";
import { strings } from "./ui/strings";

export type AppState = "idle" | "listening" | "thinking" | "speaking";

/** What the app needs from the page; implemented with plain DOM in main.ts. */
export interface AppView {
  log: ChatLog;
  setState(state: AppState): void;
  setInterim(text: string): void;
  setDebug(text: string): void;
  showNotice(text: string | null): void;
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
    public lang: Lang,
  ) {
    this.stt = new WebSpeechStt({
      onInterim: (text) => this.view.setInterim(text),
      onFinal: (text) => this.onTranscript(text),
      onError: (code) => this.onSttError(code),
    });
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
    this.stt.cancel();
    this.interrupt();
    this.view.showNotice(null);
    void this.send(trimmed, null);
  }

  newConversation(): void {
    this.stt.cancel();
    this.interrupt();
    this.sessionId = crypto.randomUUID();
    this.view.log.clear();
    this.view.setInterim("");
    this.view.setDebug("");
    this.setState("idle");
  }

  /** Takes effect on the next turn; the server tells Claude about the switch. */
  setLanguage(lang: Lang): void {
    this.lang = lang;
  }

  private interrupt(): void {
    this.current?.abort();
    this.current = null;
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
    this.view.log.addUser(text);
    const bubble = this.view.log.addAssistant();
    const controller = new AbortController();
    this.current = controller;
    this.setState("thinking");

    const sentAt = performance.now();
    let firstTextAt: number | null = null;
    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case "delta":
          if (firstTextAt === null) {
            firstTextAt = performance.now();
            if (this.current === controller) this.setState("speaking");
          }
          bubble.append(event.text);
          break;
        case "reset":
          bubble.set("");
          break;
        case "done":
          this.finishReply(bubble, event);
          this.view.setDebug(
            formatDebug({
              sttMs,
              firstTextMs: firstTextAt === null ? null : firstTextAt - sentAt,
              totalMs: performance.now() - sentAt,
              done: event,
            }),
          );
          break;
        case "error":
          bubble.error(strings.chatErrors[event.code]);
          break;
      }
    };

    try {
      await streamChat({ sessionId: this.sessionId, text, lang: this.lang }, onEvent, controller.signal);
    } catch (err) {
      if (isAbortError(err)) bubble.note(strings.interrupted);
      else bubble.error(strings.serverDown);
    } finally {
      if (this.current === controller) {
        this.current = null;
        this.setState("idle");
      }
    }
  }

  private finishReply(bubble: AssistantBubble, done: Extract<ChatEvent, { type: "done" }>): void {
    if (done.stopReason === "refusal") bubble.set(strings.refusal);
    else if (done.stopReason === "max_tokens") bubble.note(strings.truncated);
  }

  private setState(state: AppState): void {
    this.state = state;
    this.view.setState(state);
  }
}

function formatDebug(m: {
  sttMs: number | null;
  firstTextMs: number | null;
  totalMs: number;
  done: Extract<ChatEvent, { type: "done" }>;
}): string {
  const ms = (v: number | null) => (v === null ? "–" : `${Math.round(v)} ms`);
  const d = strings.debug;
  const parts = [
    m.sttMs !== null ? `${d.stt} ${ms(m.sttMs)}` : null,
    `${d.firstWord} ${ms(m.firstTextMs)}`,
    `${d.total} ${ms(m.totalMs)}`,
    m.done.usage
      ? `${d.tokens} ${m.done.usage.inputTokens}→${m.done.usage.outputTokens} · ${d.cache} ${m.done.usage.cacheReadTokens}`
      : null,
    m.done.model,
  ];
  return parts.filter(Boolean).join(" · ");
}
