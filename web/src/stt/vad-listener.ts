// Always-on listening: Silero VAD watches the (echo-cancelled) microphone and
// hands each finished utterance over as 16 kHz audio for local Whisper.
import { MicVAD, utils, type RealTimeVADOptions } from "@ricky0123/vad-web";
import { getAudio } from "../audio/context";

export interface VadHandlers {
  /** The user really started talking (not a click or a cough). */
  onSpeechStart(): void;
  /** The utterance ended; mono samples at 16 kHz. */
  onSpeechEnd(audio: Float32Array): void;
  /** Something short started and stopped; not speech after all. */
  onMisfire(): void;
}

type Thresholds = Pick<RealTimeVADOptions, "positiveSpeechThreshold" | "negativeSpeechThreshold" | "minSpeechMs">;

const NORMAL: Thresholds = { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, minSpeechMs: 250 };
// While the avatar talks, demand clearer and longer speech before barging in,
// in case some of its voice still leaks through the echo canceller.
const WHILE_AVATAR_SPEAKS: Thresholds = { positiveSpeechThreshold: 0.75, negativeSpeechThreshold: 0.5, minSpeechMs: 400 };
// The echo canceller needs a few seconds of the avatar's voice to learn the
// room after the mic opens (measured in Electron: +20 dB of echo on the first
// sentence, below the room noise from the second). Until then, only clear,
// sustained speech may interrupt.
const WARMING_UP: Thresholds = { positiveSpeechThreshold: 0.88, negativeSpeechThreshold: 0.6, minSpeechMs: 650 };
const WARM_UP_MS = 8000;
// The browser's own voice bypasses Web Audio, so no echo canceller removes it:
// while it speaks, the mic must not interrupt at all (use the key instead).
const DEAF: Thresholds = { positiveSpeechThreshold: 0.999, negativeSpeechThreshold: 0.9, minSpeechMs: 60_000 };

export class VadListener {
  private vad: MicVAD | null = null;
  /** How long the avatar has spoken since the mic opened (echo canceller training time). */
  private avatarSpokeMs = 0;
  private speakingSince: number | null = null;
  private warmUpTimer: ReturnType<typeof setTimeout> | undefined;
  private unprotectedEcho = false;
  /** Push-to-talk owns the microphone: ignore what the VAD hears. */
  private suspended = false;
  /** The current segment began before or during a suspension. */
  private segmentIgnored = false;

  /** The voice now playing cannot be echo-cancelled (browser speechSynthesis). */
  setUnprotectedEcho(unprotected: boolean): void {
    this.unprotectedEcho = unprotected;
    if (unprotected && this.speakingSince !== null) this.vad?.setOptions(DEAF);
  }

  constructor(private readonly handlers: VadHandlers) {}

  async start(): Promise<void> {
    if (this.vad) return;
    this.vad = await MicVAD.new({
      model: "v5",
      // Served from node_modules by the vad-assets plugin in vite.config.ts.
      baseAssetPath: "/vad-assets/",
      onnxWASMBasePath: "/vad-assets/",
      audioContext: getAudio().ctx,
      getStream: () =>
        navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }),
      ...NORMAL,
      redemptionMs: 800, // silence that ends an utterance (the library default 1.4 s feels sluggish)
      preSpeechPadMs: 300,
      onSpeechStart: () => {
        this.segmentIgnored = this.suspended;
      },
      onSpeechRealStart: () => {
        if (this.heard()) this.handlers.onSpeechStart();
      },
      onSpeechEnd: (audio) => {
        if (this.heard()) this.handlers.onSpeechEnd(audio);
      },
      onVADMisfire: () => {
        if (this.heard()) this.handlers.onMisfire();
      },
      startOnLoad: true,
    });
  }

  /** While push-to-talk records, the same speech must not also arrive from here. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.segmentIgnored = true; // includes a segment already under way
  }

  private heard(): boolean {
    return !this.suspended && !this.segmentIgnored;
  }

  setAvatarSpeaking(speaking: boolean): void {
    const now = performance.now();
    clearTimeout(this.warmUpTimer);
    if (speaking) {
      this.speakingSince ??= now;
    } else if (this.speakingSince !== null) {
      this.avatarSpokeMs += now - this.speakingSince;
      this.speakingSince = null;
    }
    if (!speaking) {
      this.vad?.setOptions(NORMAL);
      return;
    }
    if (this.unprotectedEcho) {
      this.vad?.setOptions(DEAF);
      return;
    }
    const left = WARM_UP_MS - (this.avatarSpokeMs + (now - this.speakingSince!));
    if (left > 0) {
      this.vad?.setOptions(WARMING_UP);
      this.warmUpTimer = setTimeout(() => this.vad?.setOptions(WHILE_AVATAR_SPEAKS), left);
    } else {
      this.vad?.setOptions(WHILE_AVATAR_SPEAKS);
    }
  }

  async stop(): Promise<void> {
    clearTimeout(this.warmUpTimer);
    const vad = this.vad;
    this.vad = null;
    await vad?.destroy();
  }
}

/** 16-bit PCM WAV, which whisper.cpp reads without ffmpeg. */
export function toWav(audio: Float32Array): ArrayBuffer {
  return utils.encodeWAV(audio, 1, 16000, 1, 16);
}
