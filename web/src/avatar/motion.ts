// Small procedural motions that keep the avatar alive: blinking, glances,
// and per-state head poses and expressions.
import type { Emotion } from "../../../shared/protocol";
import type { AppState } from "../app";

const random = (min: number, max: number) => min + Math.random() * (max - min);

/** Blinks every 2–6 s (sometimes twice); returns the blink weight 0..1. */
export class Blinker {
  private nextAt = random(1, 3);
  private start = -1;
  private double = false;

  update(time: number): number {
    if (this.start < 0 && time >= this.nextAt) {
      this.start = time;
      this.double = Math.random() < 0.15;
    }
    if (this.start < 0) return 0;
    const t = time - this.start;
    const value = blinkCurve(t) + (this.double ? blinkCurve(t - 0.28) : 0);
    if (t > (this.double ? 0.5 : 0.22)) {
      this.start = -1;
      this.nextAt = time + random(2, 6);
    }
    return Math.min(1, value);
  }
}

// Close in 70 ms, hold 30 ms, open in 120 ms.
function blinkCurve(t: number): number {
  if (t < 0 || t > 0.22) return 0;
  if (t < 0.07) return t / 0.07;
  if (t < 0.1) return 1;
  return 1 - (t - 0.1) / 0.12;
}

/** Small eye jumps around the point of focus, every 1.5–4 s. */
export class Saccades {
  private nextAt = random(1, 2);
  private offset = { x: 0, y: 0 };

  update(time: number): { x: number; y: number } {
    if (time >= this.nextAt) {
      this.offset = { x: random(-0.04, 0.04), y: random(-0.025, 0.025) };
      this.nextAt = time + random(1.5, 4);
    }
    return this.offset;
  }
}

/** Target pose for a state: head rotation (radians), gaze offset (metres, at the camera) and expressions. */
export interface StatePose {
  head: { x: number; y: number; z: number };
  gaze: { x: number; y: number };
  expressions: Record<string, number>;
}

export const STATE_POSES: Record<AppState, StatePose> = {
  idle: {
    head: { x: 0, y: 0, z: 0 },
    gaze: { x: 0, y: 0 },
    expressions: { happy: 0.1 },
  },
  // Attentive: head tilted toward the user, friendly face.
  listening: {
    head: { x: 0.04, y: 0, z: 0.09 },
    gaze: { x: 0, y: 0 },
    expressions: { happy: 0.25 },
  },
  // Pondering: looks up and to the side.
  thinking: {
    head: { x: -0.07, y: 0.12, z: -0.04 },
    gaze: { x: 0.35, y: 0.3 },
    expressions: { happy: 0 },
  },
  speaking: {
    head: { x: 0, y: 0, z: 0.02 },
    gaze: { x: 0, y: 0 },
    expressions: { happy: 0.15 },
  },
};

/** Every mood expression the avatar uses; each is driven every frame so it can fade out. */
export const MOOD_EXPRESSIONS = ["happy", "sad", "surprised", "relaxed"] as const;

/** Face and head for a mood Claude marked; added on top of the state pose (neutral = state pose only). */
export const EMOTION_POSES: Record<Exclude<Emotion, "neutral">, Pick<StatePose, "head" | "expressions">> = {
  happy: { head: { x: -0.02, y: 0, z: 0.05 }, expressions: { happy: 0.55 } },
  // Head drops a little; no smile.
  sad: { head: { x: 0.08, y: 0, z: -0.03 }, expressions: { sad: 0.6 } },
  // Head pulls back.
  surprised: { head: { x: -0.06, y: 0, z: 0 }, expressions: { surprised: 0.6 } },
  relaxed: { head: { x: 0.02, y: 0, z: 0.04 }, expressions: { relaxed: 0.45 } },
};

/** Slow, organic drift: sum of incommensurate sines in -1..1. */
export function drift(time: number, seed: number): number {
  return (Math.sin(time * 0.31 + seed) + Math.sin(time * 0.53 + seed * 2.1) * 0.6 + Math.sin(time * 0.87 + seed * 3.7) * 0.3) / 1.9;
}
