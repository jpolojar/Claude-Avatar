import type { ChatEvent, ChatRequest, HealthResponse } from "../../shared/protocol";

export async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch("/api/health");
    return res.ok ? ((await res.json()) as HealthResponse) : null;
  } catch {
    return null;
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
