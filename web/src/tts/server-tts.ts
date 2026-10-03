import type { ServerTtsEngine, TtsRequest, TtsResponse, WordTiming } from "../../../shared/protocol";
import { getAudio } from "../audio/context";
import { spokenPrefix, type Clip, type PlayResult, type PrepareOptions, type TtsEngine } from "./engine";

const FADE_OUT_S = 0.06;
// Edge pads every clip with ~0.1 s of leading and up to ~0.9 s of trailing
// silence, which makes the pauses between streamed sentences drag.
const SILENCE_THRESHOLD = 10 ** (-50 / 20); // -50 dBFS
const KEEP_LEAD_S = 0.02;
const KEEP_TAIL_S = 0.18; // a natural pause between sentences

/** Cuts leading and trailing silence; returns how much was cut from the start. */
function trimSilence(ctx: BaseAudioContext, buffer: AudioBuffer): { buffer: AudioBuffer; cutMs: number } {
  const data = buffer.getChannelData(0);
  let first = 0;
  while (first < data.length && Math.abs(data[first]!) < SILENCE_THRESHOLD) first++;
  let last = data.length - 1;
  while (last > first && Math.abs(data[last]!) < SILENCE_THRESHOLD) last--;
  if (first >= last) return { buffer, cutMs: 0 };

  const rate = buffer.sampleRate;
  const start = Math.max(0, first - Math.round(KEEP_LEAD_S * rate));
  const end = Math.min(data.length, last + Math.round(KEEP_TAIL_S * rate));
  const trimmed = ctx.createBuffer(buffer.numberOfChannels, end - start, rate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    trimmed.copyToChannel(buffer.getChannelData(channel).subarray(start, end), channel);
  }
  return { buffer: trimmed, cutMs: (start / rate) * 1000 };
}

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
    const { ctx } = getAudio();
    const { buffer, cutMs } = trimSilence(ctx, await ctx.decodeAudioData(base64ToArrayBuffer(body.audio)));
    const words = body.words.map((w) => ({ ...w, offsetMs: Math.max(0, w.offsetMs - cutMs) }));
    return new BufferClip(this.id, voice, text, buffer, words, performance.now() - started);
  }
}

class BufferClip implements Clip {
  constructor(
    readonly engine: ServerTtsEngine,
    readonly voice: string,
    readonly text: string,
    private readonly buffer: AudioBuffer,
    readonly words: readonly WordTiming[],
    readonly prepareMs: number,
  ) {}

  play(signal: AbortSignal): Promise<PlayResult> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve({ completed: false, spokenText: "" });
      const { ctx, output } = getAudio();
      const startedAt = ctx.currentTime;
      let stoppedAt: number | null = null;
      const source = ctx.createBufferSource();
      source.buffer = this.buffer;
      const gain = ctx.createGain();
      source.connect(gain).connect(output);

      const onAbort = () => {
        const now = ctx.currentTime;
        stoppedAt = now;
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
        source.stop(now + FADE_OUT_S);
      };
      source.onended = () => {
        signal.removeEventListener("abort", onAbort);
        source.disconnect();
        gain.disconnect();
        if (stoppedAt === null) return resolve({ completed: true, spokenText: this.text });
        const playedMs = (stoppedAt - startedAt) * 1000;
        resolve({
          completed: false,
          spokenText: spokenPrefix(this.text, this.words, playedMs, this.buffer.duration * 1000),
        });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      source.start();
    });
  }
}
