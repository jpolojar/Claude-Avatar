// Optional offline fallback: Piper's HTTP server (fi_FI-harri-medium, male voice).
//   pip install piper-tts[http]
//   python -m piper.download_voices fi_FI-harri-medium
//   python -m piper.http_server -m fi_FI-harri-medium
import type { SynthResult } from "./types.js";

export async function piperAvailable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/voices`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function synthesizePiper(baseUrl: string, text: string, ratePercent: number): Promise<SynthResult> {
  const res = await fetch(`${baseUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // length_scale > 1 is slower; map the rate percentage onto it.
    body: JSON.stringify({ text, length_scale: 1 / (1 + ratePercent / 100) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Piper HTTP ${res.status}`);
  return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/wav", words: [] };
}
