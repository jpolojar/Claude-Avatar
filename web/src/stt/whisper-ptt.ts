// Push-to-talk for local Whisper: records the echo-cancelled microphone while
// the key is held and returns 16 kHz mono audio for toWav(). The microphone
// stays open between presses, so recording starts instantly and the echo
// canceller keeps what it has learned about the room.
import { getAudio } from "../audio/context";

const PROCESSOR = "avatar-ptt-recorder";
const PRE_ROLL_S = 0.25; // audio kept from just before the key went down
const WHISPER_RATE = 16000;
const VOICE_RMS = 0.012;
const MIN_VOICE_S = 0.15; // of 50 ms windows louder than VOICE_RMS

// Runs on the audio thread: keeps a short ring of recent audio and, while
// recording, posts every block to the page.
const WORKLET_SOURCE = `
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.ring = new Float32Array(Math.ceil(sampleRate * ${PRE_ROLL_S}));
    this.ringPos = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "start") {
        const ring = this.ring;
        const preRoll = new Float32Array(ring.length);
        preRoll.set(ring.subarray(this.ringPos));
        preRoll.set(ring.subarray(0, this.ringPos), ring.length - this.ringPos);
        this.port.postMessage(preRoll);
        this.recording = true;
      } else if (data === "stop") {
        this.recording = false;
        this.port.postMessage("stopped");
      }
    };
  }
  process(inputs) {
    const block = inputs[0] && inputs[0][0];
    if (!block) return true;
    if (this.recording) this.port.postMessage(block.slice(0));
    for (let i = 0; i < block.length; i++) {
      this.ring[this.ringPos] = block[i];
      this.ringPos = (this.ringPos + 1) % this.ring.length;
    }
    return true;
  }
}
registerProcessor("${PROCESSOR}", Recorder);
`;

let workletLoaded: Promise<void> | null = null;

export class WhisperPtt {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private opening: Promise<void> | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;

  /** Opens the microphone ahead of the first press. Throws if it cannot. */
  open(): Promise<void> {
    this.opening ??= this.doOpen().catch((err: unknown) => {
      this.opening = null;
      throw err;
    });
    return this.opening;
  }

  private async doOpen(): Promise<void> {
    const { ctx } = getAudio();
    workletLoaded ??= ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" })),
    );
    await workletLoaded;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    // A silent path to the speakers keeps the node in the rendered graph.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node).connect(sink).connect(ctx.destination);
    node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>) => {
      if (this.recording && data instanceof Float32Array) this.chunks.push(data);
    };
    Object.assign(this, { stream, source, node });
  }

  get isRecording(): boolean {
    return this.recording;
  }

  async start(): Promise<void> {
    await this.open();
    this.chunks = [];
    this.recording = true;
    this.node!.port.postMessage("start");
  }

  /** Stops recording; null if the press was too short or silent to be speech. */
  async stop(): Promise<Float32Array | null> {
    if (!this.recording || !this.node) return null;
    const node = this.node;
    // Wait for the blocks still in flight from the audio thread.
    await new Promise<void>((resolve) => {
      const onStopped = ({ data }: MessageEvent) => {
        if (data !== "stopped") return;
        node.port.removeEventListener("message", onStopped);
        resolve();
      };
      node.port.addEventListener("message", onStopped);
      node.port.postMessage("stop");
    });
    this.recording = false;
    const audio = concat(this.chunks);
    this.chunks = [];
    const rate = getAudio().ctx.sampleRate;
    if (audio.length < rate * (PRE_ROLL_S + 0.3) || !hasVoice(audio, rate)) return null;
    return resample(audio, rate);
  }

  /** Throws away a recording in progress. */
  cancel(): void {
    if (!this.recording) return;
    this.recording = false;
    this.chunks = [];
    this.node?.port.postMessage("stop");
  }

  /** Releases the microphone (muted). */
  close(): void {
    this.cancel();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = this.source = this.node = null;
    this.opening = null;
  }
}

function concat(chunks: Float32Array[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Whether the recording holds voice at all: Whisper invents text ("Kiitos.")
 *  from silence. Silence measured about 0.00002 RMS with clicks up to 0.007;
 *  speech after automatic gain control stays well above 0.02. */
function hasVoice(audio: Float32Array, rate: number): boolean {
  const window = Math.round(rate * 0.05);
  let loud = 0;
  for (let start = 0; start + window <= audio.length; start += window) {
    let sum = 0;
    for (let i = start; i < start + window; i++) sum += audio[i] * audio[i];
    if (Math.sqrt(sum / window) > VOICE_RMS) loud++;
  }
  return loud * 0.05 >= MIN_VOICE_S;
}

async function resample(audio: Float32Array<ArrayBuffer>, rate: number): Promise<Float32Array> {
  if (rate === WHISPER_RATE) return audio;
  const offline = new OfflineAudioContext(1, Math.ceil((audio.length * WHISPER_RATE) / rate), WHISPER_RATE);
  const buffer = offline.createBuffer(1, audio.length, rate);
  buffer.copyToChannel(audio, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}
