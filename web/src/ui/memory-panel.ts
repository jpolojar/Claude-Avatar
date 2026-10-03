import { clearMemory, fetchMemory } from "../api";
import type { MemoryResponse } from "../../../shared/protocol";
import { byId } from "./dom";
import { strings } from "./strings";

/** The "Muisti" panel: shows what the avatar remembers and lets the user wipe it. */
export function bindMemoryPanel(): void {
  const panel = byId<HTMLDetailsElement>("memory-panel");
  const text = byId("memory-text");
  const updated = byId("memory-updated");
  const clearButton = byId<HTMLButtonElement>("memory-clear");

  const render = (memory: MemoryResponse) => {
    text.textContent = memory.summary ?? strings.memory.empty;
    updated.textContent = memory.updatedAt ? strings.memory.updated(memory.updatedAt) : "";
    clearButton.disabled = !memory.summary;
  };

  const load = async () => {
    try {
      render(await fetchMemory());
    } catch {
      text.textContent = strings.memory.failed;
    }
  };

  // Load when opened, so it reflects summaries made since the page loaded.
  panel.addEventListener("toggle", () => {
    if (panel.open) void load();
  });

  clearButton.addEventListener("click", async () => {
    if (!confirm(strings.memory.confirmClear)) return;
    try {
      render(await clearMemory());
    } catch {
      text.textContent = strings.memory.failed;
    }
  });
}
