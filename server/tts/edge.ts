// Microsoft Edge "Read Aloud" neural voices through the msedge-tts library.
// This is an unofficial endpoint: it is free but may change, so the browser
// falls back to its own speechSynthesis voices when this fails.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { WordTiming } from "../../shared/protocol.js";
import type { SynthResult } from "./types.js";

const TIMEOUT_MS = 15_000;
const TICKS_PER_MS = 10_000; // boundary offsets are in 100 ns ticks

interface BoundaryItem {
  Type: string;
  Data: { Offset: number; Duration: number; text: { Text: string } };
}

// One instance per voice: switching a shared instance to another voice closes
// its socket in a way that surfaces as an unhandled stream error.
const instances = new Map<string, Promise<MsEdgeTTS>>();

function getInstance(voice: string): Promise<MsEdgeTTS> {
  let instance = instances.get(voice);
  if (!instance) {
    instance = (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
      return tts;
    })();
    instances.set(voice, instance);
    instance.catch(() => instances.delete(voice));
  }
  return instance;
}

function dropInstance(voice: string): void {
  const instance = instances.get(voice);
  instances.delete(voice);
  instance?.then((tts) => tts.close()).catch(() => {});
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function synthesizeOnce(text: string, voice: string, ratePercent: number): Promise<SynthResult> {
  const tts = await getInstance(voice);
  const prosody = ratePercent ? { rate: `${ratePercent > 0 ? "+" : ""}${ratePercent}%` } : undefined;
  const { audioStream, metadataStream } = tts.toStream(escapeXml(text), prosody);

  const chunks: Buffer[] = [];
  const words: WordTiming[] = [];

  const audioDone = new Promise<void>((resolve, reject) => {
    audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    audioStream.once("end", resolve);
    audioStream.once("error", reject);
  });
  const metadataDone = new Promise<void>((resolve) => {
    if (!metadataStream) return resolve();
    metadataStream.on("data", (chunk: Buffer) => {
      const items = (JSON.parse(chunk.toString()) as { Metadata: BoundaryItem[] }).Metadata;
      for (const item of items) {
        if (item.Type !== "WordBoundary") continue;
        words.push({
          text: item.Data.text.Text,
          offsetMs: item.Data.Offset / TICKS_PER_MS,
          durationMs: item.Data.Duration / TICKS_PER_MS,
        });
      }
    });
    // Errors here are reported on the audio stream as well; timings are best effort.
    metadataStream.once("end", resolve);
    metadataStream.once("close", resolve);
    metadataStream.once("error", () => resolve());
  });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("edge-tts timed out")), TIMEOUT_MS);
  });
  try {
    await Promise.race([Promise.all([audioDone, metadataDone]), timeout]);
  } finally {
    clearTimeout(timer);
  }

  if (chunks.length === 0) throw new Error("edge-tts returned no audio");
  return { audio: Buffer.concat(chunks), mime: "audio/mpeg", words };
}

export async function synthesizeEdge(text: string, voice: string, ratePercent: number): Promise<SynthResult> {
  try {
    return await synthesizeOnce(text, voice, ratePercent);
  } catch {
    // Stale or closed socket: retry once on a fresh connection.
    dropInstance(voice);
    return await synthesizeOnce(text, voice, ratePercent);
  }
}
