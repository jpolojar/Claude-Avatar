import type { ChatEvent, Emotion, Lang, TtsEngineId } from "../../shared/protocol";
import { endSession, isAbortError, streamChat, transcribe } from "./api";
import type { ListenMode, Settings } from "./settings";
import { VadListener, toWav } from "./stt/vad-listener";
import { WhisperPtt } from "./stt/whisper-ptt";
import { WebSpeechStt } from "./stt/webspeech";
import type { Clip } from "./tts/engine";
import { SpeechQueue } from "./tts/queue";
import type { Speaker } from "./tts/speaker";
import type { ConversationLog } from "./ui/chat-log";
import { strings } from "./ui/strings";

export type AppState = "idle" | "listening" | "thinking" | "speaking";

/** What the app needs from the page; implemented with plain DOM in main.ts. */
export interface AppView {
  log: ConversationLog;
  setState(state: AppState): void;
  setInterim(text: string): void;
  setDebug(text: string): void;
  showNotice(text: string | null): void;
  /** Claude switched the conversation language; update the settings and the UI. */
  setLanguage(lang: Lang): void;
  /** Speech started (with the engine that plays it) or ended (null); drives lip sync. */
  setSpeaking(engine: TtsEngineId | null): void;
  /** The mood Claude marked for the sentence now being spoken. */
  setEmotion(emotion: Emotion): void;
  /** Claude is searching the web ("" when the query is unknown), or stopped (null). */
  setSearch(query: string | null): void;
  /** A sentence starts playing (widgets show it as a speech bubble). */
  showSentence?(text: string): void;
}

/** Silence between sentences longer than this means Claude is still busy. */
const SPEECH_GAP_MS = 400;

type DoneEvent = Extract<ChatEvent, { type: "done" }>;

/** Latency of one turn, measured from sending the text; shown on the status line. */
interface TurnTimings {
  sttMs: number | null;
  firstTextMs: number | null;
  firstSentenceMs: number | null;
  audioStartMs: number | null;
  ttsMs: number | null;
  engine: TtsEngineId | null;
  done: DoneEvent | null;
}

const STT_LANG: Record<Lang, string> = { fi: "fi-FI", en: "en-US" };

export interface AppOptions {
  /** Who transcribes push-to-talk: the browser (Web Speech) or local Whisper.
   *  Electron has no Web Speech, so the desktop widget uses Whisper. */
  pttStt?: "webspeech" | "whisper";
}

export class App {
  private state: AppState = "idle";
  private sessionId = crypto.randomUUID();
  private current: AbortController | null = null;
  private releasedAt: number | null = null;
  private sttError: string | null = null;
  private readonly stt: WebSpeechStt;
  private readonly whisperPtt: WhisperPtt | null;
  /** The push-to-talk recording getting under way (the mic may still be opening). */
  private pttStarting: Promise<boolean> | null = null;

  // Always-on listening.
  private listener: VadListener | null = null;
  private utterance = 0;
  /** Transcript of an utterance that was followed by more speech before it was sent. */
  private heardSoFar = "";

  /** What the user actually heard of the last reply, if they cut it off. */
  private pendingInterruption: string | null = null;
  /** Resolves when the latest turn has fully wound down (speech stopped). */
  private lastTurn: Promise<void> = Promise.resolve();

  constructor(
    private readonly view: AppView,
    private readonly settings: () => Settings,
    private readonly speaker: Speaker,
    options: AppOptions = {},
  ) {
    this.whisperPtt = options.pttStt === "whisper" ? new WhisperPtt() : null;
    this.stt = new WebSpeechStt({
      onInterim: (text) => this.view.setInterim(text),
      onFinal: (text) => this.onTranscript(text),
      onError: (code) => this.onSttError(code),
    });
  }

  private get lang(): Lang {
    return this.settings().lang;
  }

  private get alwaysOn(): boolean {
    return this.listener !== null;
  }

  /** Switches between push-to-talk and always-on listening. Throws if the microphone or VAD fails. */
  async setListenMode(mode: ListenMode): Promise<void> {
    if (mode === "always" && !this.listener) {
      const listener = new VadListener({
        onSpeechStart: () => this.onVoiceStart(),
        onSpeechEnd: (audio) => void this.onVoiceEnd(audio),
        onMisfire: () => this.onVoiceMisfire(),
      });
      await listener.start();
      this.listener = listener;
    } else if (mode === "ptt" && this.listener) {
      const listener = this.listener;
      this.listener = null;
      await listener.stop();
    }
    this.setState(this.state); // refresh the status label
  }

  /** Opens the push-to-talk microphone ahead of the first press (Whisper only). */
  prepareMic(): Promise<void> {
    return this.whisperPtt?.open() ?? Promise.resolve();
  }

  /** Releases the push-to-talk microphone (muted). */
  releaseMic(): void {
    this.whisperPtt?.close();
    this.listener?.setSuspended(false);
  }

  /** Space or the button pressed: push-to-talk, or just "stop talking" when always on
   *  (with Whisper, push-to-talk works in both modes). */
  startListening(): void {
    if (this.whisperPtt) {
      this.pttStarting ??= this.startWhisperPtt(this.whisperPtt);
      return;
    }
    if (this.alwaysOn) {
      this.interrupt();
      this.setState("idle");
      return;
    }
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
    if (this.whisperPtt) {
      void this.finishWhisperPtt(this.whisperPtt);
      return;
    }
    if (this.alwaysOn || this.state !== "listening") return;
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
    this.utterance++; // drops a transcription still on its way
    this.whisperPtt?.cancel();
    this.pttStarting = null;
    this.listener?.setSuspended(false);
    this.interrupt();
    this.setState("idle");
  }

  newConversation(): void {
    this.stop();
    endSession(this.sessionId); // fold the finished conversation into memory
    this.sessionId = crypto.randomUUID();
    this.pendingInterruption = null;
    this.heardSoFar = "";
    this.view.log.clear();
    this.view.setInterim("");
    this.view.setDebug("");
  }

  /** The page is closing. */
  endConversation(): void {
    endSession(this.sessionId);
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

  // --- Push-to-talk (Web Speech) --------------------------------------------

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

  // --- Push-to-talk (Whisper) -------------------------------------------------

  private async startWhisperPtt(ptt: WhisperPtt): Promise<boolean> {
    this.stt.cancel();
    this.utterance++;
    this.interrupt();
    this.listener?.setSuspended(true); // the same speech must not come in twice
    this.view.showNotice(null);
    this.setState("listening");
    try {
      await ptt.start();
      return true;
    } catch (err) {
      this.listener?.setSuspended(false);
      this.setState("idle");
      this.view.showNotice(strings.micFailed(err instanceof Error ? err.message : String(err)));
      return false;
    }
  }

  private async finishWhisperPtt(ptt: WhisperPtt): Promise<void> {
    const starting = this.pttStarting;
    this.pttStarting = null;
    if (!starting || !(await starting) || !ptt.isRecording) return;
    const utterance = this.utterance;
    const endedAt = performance.now();
    const audio = await ptt.stop();
    this.listener?.setSuspended(false);
    if (this.utterance !== utterance) return;
    if (!audio) {
      this.setState("idle");
      this.view.showNotice(strings.noSpeechHotkey);
      return;
    }
    this.setState("thinking");
    let text: string;
    try {
      text = (await transcribe(toWav(audio), this.lang)).text.trim();
    } catch {
      this.view.showNotice(strings.whisperFailed);
      if (this.utterance === utterance) this.setState("idle");
      return;
    }
    if (this.utterance !== utterance) return;
    // Anything always-on listening caught just before the key went down comes first.
    const full = `${this.heardSoFar} ${text}`.trim();
    this.heardSoFar = "";
    if (!full) {
      this.setState("idle");
      this.view.showNotice(strings.noSpeechHotkey);
      return;
    }
    void this.send(full, performance.now() - endedAt);
  }

  // --- Always-on (VAD + Whisper) ----------------------------------------------

  /** The user started talking: barge in on whatever the avatar was doing. */
  private onVoiceStart(): void {
    this.utterance++;
    this.interrupt();
    this.view.showNotice(null);
    this.setState("listening");
  }

  private onVoiceMisfire(): void {
    if (this.state === "listening" && !this.current) this.setState("idle");
  }

  private async onVoiceEnd(audio: Float32Array): Promise<void> {
    const utterance = this.utterance;
    const endedAt = performance.now();
    this.setState("thinking");
    let text: string;
    try {
      text = (await transcribe(toWav(audio), this.lang)).text;
    } catch {
      this.view.showNotice(strings.whisperFailed);
      if (this.utterance === utterance) this.setState("idle");
      return;
    }
    if (this.utterance !== utterance) {
      // They kept talking: send this together with the next utterance.
      this.heardSoFar = `${this.heardSoFar} ${text}`.trim();
      return;
    }
    const full = `${this.heardSoFar} ${text}`.trim();
    this.heardSoFar = "";
    if (!full) {
      this.setState("idle");
      return;
    }
    void this.send(full, performance.now() - endedAt);
  }

  // --- A conversation turn ------------------------------------------------------

  private async send(text: string, sttMs: number | null): Promise<void> {
    // Let the previous turn wind down first, so what it got to say is known.
    const previous = this.lastTurn;
    let turnFinished!: () => void;
    this.lastTurn = new Promise((resolve) => (turnFinished = resolve));

    let lang = this.lang;
    const removeUserBubble = this.view.log.addUser(text);
    const bubble = this.view.log.addAssistant();
    const controller = this.beginTurn();

    const sentAt = performance.now();
    const timings: TurnTimings = {
      sttMs,
      firstTextMs: null,
      firstSentenceMs: null,
      audioStartMs: null,
      ttsMs: null,
      engine: null,
      done: null,
    };
    const showTimings = () => this.view.setDebug(formatDebug(timings));

    // When speech runs dry mid-turn (Claude is searching or still writing),
    // look thoughtful instead of standing there in the speaking pose.
    let gapTimer: ReturnType<typeof setTimeout> | undefined;
    let fillerSpoken = false;

    // Sentences are spoken as they arrive. A fallback reset or a refusal
    // replaces whatever is queued, so speech gets its own chained abort signal.
    let ttsErrorShown = false;
    const startSpeech = () => {
      const speech = new AbortController();
      controller.signal.addEventListener("abort", () => speech.abort(), { once: true });
      const queue = new SpeechQueue((sentence, signal) => this.speaker.prepare(sentence, lang, signal), speech.signal, {
        onClipStart: (clip, _index, emotion) => {
          clearTimeout(gapTimer);
          if (timings.audioStartMs === null) {
            timings.audioStartMs = performance.now() - sentAt;
            timings.ttsMs = clip.prepareMs;
            timings.engine = clip.engine;
            showTimings();
          }
          if (emotion) this.view.setEmotion(emotion);
          this.listener?.setUnprotectedEcho(clip.engine === "browser");
          if (this.current === controller) this.setState("speaking");
          this.view.setSpeaking(clip.engine);
          this.view.showSentence?.(clip.text);
        },
        onClipEnd: () => {
          this.view.setSpeaking(null);
          clearTimeout(gapTimer);
          gapTimer = setTimeout(() => {
            if (this.current === controller && this.state === "speaking") this.setState("thinking");
          }, SPEECH_GAP_MS);
        },
        onError: () => {
          if (ttsErrorShown) return;
          ttsErrorShown = true;
          this.view.showNotice(strings.ttsFailed);
        },
      });
      return { queue, stop: () => speech.abort() };
    };
    let speech = startSpeech();
    const restartSpeech = () => {
      speech.stop();
      speech = startSpeech();
    };

    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case "delta":
          timings.firstTextMs ??= performance.now() - sentAt;
          bubble.append(event.text);
          break;
        case "sentence":
          timings.firstSentenceMs ??= performance.now() - sentAt;
          speech.queue.push(event.text, event.emotion);
          break;
        case "search":
          this.view.setSearch(event.query ?? "");
          bubble.note(event.query ? strings.searchedFor(event.query) : strings.searched);
          // Claude says nothing before a tool call (the model turns such text
          // into hidden progress notes), so fill the silence ourselves.
          if (!fillerSpoken && timings.firstSentenceMs === null) {
            fillerSpoken = true;
            const fillers = strings.searchFillers[lang];
            speech.queue.push(fillers[Math.floor(Math.random() * fillers.length)]!, "neutral");
          }
          break;
        case "reset":
          bubble.set("");
          restartSpeech();
          break;
        case "lang":
          // Speak this reply, and listen from now on, in the new language.
          lang = event.lang;
          this.view.setLanguage(lang);
          break;
        case "done":
          timings.done = event;
          if (event.stopReason === "refusal") {
            bubble.set(strings.refusal);
            restartSpeech();
            speech.queue.push(strings.refusalSpoken[lang]);
          } else if (event.stopReason === "max_tokens") {
            bubble.note(strings.truncated);
          }
          showTimings();
          break;
        case "error":
          bubble.error(strings.chatErrors[event.code]);
          break;
      }
    };

    try {
      await previous;
      const interruption = this.pendingInterruption;
      this.pendingInterruption = null;
      try {
        await streamChat(
          {
            sessionId: this.sessionId,
            text,
            lang,
            ...(interruption !== null ? { interruption: { spokenText: interruption } } : {}),
          },
          onEvent,
          controller.signal,
        );
        speech.queue.close();
      } catch (err) {
        if (!isAbortError(err)) {
          speech.stop();
          bubble.error(strings.serverDown);
        }
      }
      await speech.queue.done; // returns right away after an interruption
      if (controller.signal.aborted) {
        if (timings.firstTextMs !== null) {
          bubble.note(strings.interrupted);
          // Tell Claude on the next turn how far the user actually listened.
          this.pendingInterruption = speech.queue.spokenText;
        } else if (this.alwaysOn) {
          // Cut off before any reply (they paused mid-thought and went on):
          // the server dropped this turn, so it is sent again with what follows.
          this.heardSoFar = `${text} ${this.heardSoFar}`.trim();
          removeUserBubble();
          bubble.remove();
        } else {
          bubble.note(strings.interrupted);
        }
      }
    } finally {
      clearTimeout(gapTimer);
      this.view.setSearch(null);
      this.endTurn(controller);
      turnFinished();
    }
  }

  /** Synthesizes and plays text. A TTS failure is reported but does not fail the turn. */
  private async speak(text: string, lang: Lang, controller: AbortController): Promise<void> {
    let clip: Clip;
    try {
      clip = await this.speaker.prepare(text, lang, controller.signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      this.view.showNotice(strings.ttsFailed);
      return;
    }
    if (controller.signal.aborted) return;
    this.listener?.setUnprotectedEcho(clip.engine === "browser");
    if (this.current === controller) this.setState("speaking");
    this.view.setSpeaking(clip.engine);
    this.view.showSentence?.(clip.text);
    try {
      await clip.play(controller.signal);
    } finally {
      this.view.setSpeaking(null);
    }
  }

  private setState(state: AppState): void {
    this.state = state;
    this.listener?.setAvatarSpeaking(state === "speaking");
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
    t.firstSentenceMs !== null ? `${d.firstSentence} ${ms(t.firstSentenceMs)}` : null,
    t.audioStartMs !== null ? `${d.audioStart} ${ms(t.audioStartMs)} (${d.tts} ${ms(t.ttsMs)}, ${t.engine})` : null,
    usage ? `${d.tokens} ${usage.inputTokens}→${usage.outputTokens} · ${d.cache} ${usage.cacheReadTokens}` : null,
    usage?.webSearches ? `${d.searches} ${usage.webSearches}` : null,
    t.done?.model ?? null,
  ];
  return parts.filter(Boolean).join(" · ");
}
