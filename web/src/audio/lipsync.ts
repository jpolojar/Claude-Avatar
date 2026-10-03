// Mouth movement from the speech audio: loudness opens the mouth, and the
// spectral "brightness" tints the vowel (bright → ee/ih, dark → oh/ou).

export interface MouthShape {
  /** 0 = closed, 1 = fully open. */
  level: number;
  /** 0 = dark vowel (o, u), 1 = bright vowel (e, i). */
  brightness: number;
}

// Calibrated on Edge's Noora: speech RMS has a median of about -19 dBFS and
// a 90th percentile of -15 dBFS; with the curve below a typical syllable
// opens the mouth to ~60 % and only stressed ones fully.
const CLOSED_DB = -40; // at or below this the mouth is closed
const OPEN_DB = -10; // at or above this the mouth is fully open
const OPEN_CURVE = 1.4;
const ATTACK_S = 0.03;
const RELEASE_S = 0.09;
// Spectral centroid of voiced frames (80–4000 Hz, above the noise floor)
// spans roughly 450–1300 Hz for the same voice.
const DARK_HZ = 450;
const BRIGHT_HZ = 1300;
const CENTROID_MIN_HZ = 80;
const CENTROID_MAX_HZ = 4000;
const SPECTRUM_FLOOR = 90; // of 255; ignore the noise floor in byte spectra

export class AmplitudeLipSync {
  private samples: Float32Array<ArrayBuffer> | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private shape: MouthShape = { level: 0, brightness: 0.5 };

  update(analyser: AnalyserNode, dt: number): MouthShape {
    if (this.samples?.length !== analyser.fftSize) this.samples = new Float32Array(analyser.fftSize);
    if (this.spectrum?.length !== analyser.frequencyBinCount) this.spectrum = new Uint8Array(analyser.frequencyBinCount);

    analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const s of this.samples) sum += s * s;
    const db = 10 * Math.log10(Math.max(sum / this.samples.length, 1e-10));
    const target = clamp01((db - CLOSED_DB) / (OPEN_DB - CLOSED_DB)) ** OPEN_CURVE;

    // Open quickly, close a little slower, like a real jaw.
    const tau = target > this.shape.level ? ATTACK_S : RELEASE_S;
    const level = approach(this.shape.level, target, dt, tau);

    let brightness = this.shape.brightness;
    if (target > 0.1) {
      analyser.getByteFrequencyData(this.spectrum);
      const binHz = analyser.context.sampleRate / analyser.fftSize;
      const last = Math.min(this.spectrum.length, Math.floor(CENTROID_MAX_HZ / binHz));
      let weighted = 0;
      let total = 0;
      for (let i = Math.ceil(CENTROID_MIN_HZ / binHz); i < last; i++) {
        const above = Math.max(0, (this.spectrum[i] ?? 0) - SPECTRUM_FLOOR);
        const power = above * above;
        weighted += power * i * binHz;
        total += power;
      }
      const centroid = total > 0 ? weighted / total : DARK_HZ;
      brightness = approach(brightness, clamp01((centroid - DARK_HZ) / (BRIGHT_HZ - DARK_HZ)), dt, 0.08);
    }

    this.shape = { level, brightness };
    return this.shape;
  }

  reset(): void {
    this.shape = { level: 0, brightness: 0.5 };
  }
}

/** Mouth flapping without audio access (browser speechSynthesis fallback). */
export function proceduralMouth(time: number): MouthShape {
  const wave = (Math.sin(time * 11.3) + Math.sin(time * 7.1 + 1.3) + Math.sin(time * 3.7 + 0.4)) / 3;
  return { level: clamp01(0.3 + wave * 0.55), brightness: 0.5 + Math.sin(time * 2.3) * 0.3 };
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Exponential approach of `current` to `target` with time constant `tau` seconds. */
export function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}
