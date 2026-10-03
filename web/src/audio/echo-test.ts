// Measures how much of the avatar's own voice leaks from the speakers into the
// microphone, with the browser's echo cancellation on and off. The result
// decides how strict voice barge-in must be in phase e.
import { getAudio } from "./context";

export interface LeakReport {
  /** Mic level while nothing plays (dBFS). */
  silenceDb: number;
  /** Mic level while the avatar speaks (dBFS). */
  playbackDb: number;
  /** playbackDb - silenceDb: how far the echo rises above the room. */
  leakDb: number;
}

export interface EchoTestResult {
  aecOn: LeakReport;
  aecOff: LeakReport;
}

const SILENCE_MS = 1000;
const CONVERGE_MS = 1500; // the echo canceller needs a moment to adapt
const MEASURE_MS = 2500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toDb(power: number): number {
  return 10 * Math.log10(Math.max(power, 1e-10));
}

async function averagePower(analyser: AnalyserNode, durationMs: number): Promise<number> {
  const samples = new Float32Array(analyser.fftSize);
  let total = 0;
  let count = 0;
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    total += sum / samples.length;
    count++;
    await sleep(50);
  }
  return count ? total / count : 0;
}

async function measure(echoCancellation: boolean, play: (signal: AbortSignal) => Promise<void>): Promise<LeakReport> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation, noiseSuppression: true, autoGainControl: false },
  });
  const { ctx } = getAudio();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser); // never to the speakers

  try {
    const silence = await averagePower(analyser, SILENCE_MS);
    const stop = new AbortController();
    const playing = play(stop.signal);
    await sleep(CONVERGE_MS);
    const playback = await averagePower(analyser, MEASURE_MS);
    stop.abort();
    await playing;
    const silenceDb = toDb(silence);
    const playbackDb = toDb(playback);
    return { silenceDb, playbackDb, leakDb: playbackDb - silenceDb };
  } finally {
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
  }
}

/** `play` must play the same sample each time it is called (at least ~4 s long). */
export async function runEchoTest(play: (signal: AbortSignal) => Promise<void>): Promise<EchoTestResult> {
  const aecOn = await measure(true, play);
  await sleep(500);
  const aecOff = await measure(false, play);
  return { aecOn, aecOff };
}
