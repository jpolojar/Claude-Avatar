import type {
  ChatEvent,
  ChatRequest,
  HealthResponse,
  Lang,
  MemoryResponse,
  SttResponse,
  VoiceOption,
} from "../../shared/protocol";

/** Sends an utterance (WAV) to the local Whisper server through the Node server. */
export async function transcribe(wav: ArrayBuffer, lang: Lang): Promise<SttResponse> {
  const res = await fetch(`/api/stt?lang=${lang}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });
  if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
  return (await res.json()) as SttResponse;
}

/** Lets the server fold the conversation into memory; survives page unload. */
export function endSession(sessionId: string): void {
  void fetch("/api/session/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
    keepalive: true,
  }).catch(() => {});
}

export async function fetchMemory(): Promise<MemoryResponse> {
  const res = await fetch("/api/memory");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as MemoryResponse;
}

export async function clearMemory(): Promise<MemoryResponse> {
  const res = await fetch("/api/memory", { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as MemoryResponse;
}

export async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch("/api/health");
    return res.ok ? ((await res.json()) as HealthResponse) : null;
  } catch {
    return null;
  }
}

export async function fetchVoices(): Promise<VoiceOption[]> {
  try {
    const res = await fetch("/api/tts/voices");
    return res.ok ? ((await res.json()) as VoiceOption[]) : [];
  } catch {
    return [];
  }
}

/**
 * Posts a chat turn and calls onEvent for each NDJSON event as it streams in.
 * Rejects with an AbortError when the signal fires, and with a plain Error when
 * the server cannot be reached (the dev proxy answers 5xx in that case).
 */
export async function streamChat(
  request: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (res.status === 400) {
    onEvent({ type: "error", code: "bad_request", message: "HTTP 400" });
    return;
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as ChatEvent);
    }
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
