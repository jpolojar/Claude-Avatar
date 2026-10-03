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

export class VadListener {
  private vad: MicVAD | null = null;

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
      onSpeechRealStart: () => this.handlers.onSpeechStart(),
      onSpeechEnd: (audio) => this.handlers.onSpeechEnd(audio),
      onVADMisfire: () => this.handlers.onMisfire(),
      startOnLoad: true,
    });
  }

  setAvatarSpeaking(speaking: boolean): void {
    this.vad?.setOptions(speaking ? WHILE_AVATAR_SPEAKS : NORMAL);
  }

  async stop(): Promise<void> {
    const vad = this.vad;
    this.vad = null;
    await vad?.destroy();
  }
}

/** 16-bit PCM WAV, which whisper.cpp reads without ffmpeg. */
export function toWav(audio: Float32Array): ArrayBuffer {
  return utils.encodeWAV(audio, 1, 16000, 1, 16);
}
