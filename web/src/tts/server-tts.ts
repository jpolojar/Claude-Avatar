import type { ServerTtsEngine, TtsRequest, TtsResponse, WordTiming } from "../../../shared/protocol";
import { getAudio } from "../audio/context";
import type { Clip, PrepareOptions, TtsEngine } from "./engine";

const FADE_OUT_S = 0.06;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Edge or Piper voices synthesized by the Node server, played with Web Audio. */
export class ServerTts implements TtsEngine {
  constructor(readonly id: ServerTtsEngine) {}

  async prepare(text: string, { voice, rate, signal }: PrepareOptions): Promise<Clip> {
    if (!voice) throw new Error(`No ${this.id} voice for this language`);
    const started = performance.now();
    const request: TtsRequest = { text, engine: this.id, voice, rate };
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const body = (await res.json()) as TtsResponse;
    const buffer = await getAudio().ctx.decodeAudioData(base64ToArrayBuffer(body.audio));
    return new BufferClip(this.id, voice, buffer, body.words, performance.now() - started);
  }
}

class BufferClip implements Clip {
  constructor(
    readonly engine: ServerTtsEngine,
    readonly voice: string,
    private readonly buffer: AudioBuffer,
    readonly words: readonly WordTiming[],
    readonly prepareMs: number,
  ) {}

  play(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const { ctx, output } = getAudio();
      const source = ctx.createBufferSource();
      source.buffer = this.buffer;
      const gain = ctx.createGain();
      source.connect(gain).connect(output);

      const onAbort = () => {
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
        source.stop(now + FADE_OUT_S);
      };
      source.onended = () => {
        signal.removeEventListener("abort", onAbort);
        source.disconnect();
        gain.disconnect();
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      source.start();
    });
  }
}
