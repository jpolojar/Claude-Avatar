// The desktop settings window: widget options (kept by the Electron main
// process), voice settings (localStorage, shared with the widget), memory and
// the conversation so far. Opened from the tray, the avatar's menu or by
// double-clicking the avatar.
import type { AppSetup, HistoryEntry, WidgetOptions, WidgetStatus } from "../../../shared/desktop";
import type { Lang } from "../../../shared/protocol";
import { createSettingsStore, keepLoadingVoices } from "../core";
import { desktop } from "../desktop";
import { byId } from "../ui/dom";
import { bindMemoryPanel } from "../ui/memory-panel";
import { bindSettingsPanel } from "../ui/settings-panel";
import { strings } from "../ui/strings";

const text = strings.settingsWindow;

// --- Voice, language and memory (shared with the widget through localStorage) ----

const store = createSettingsStore();
const langSelect = byId<HTMLSelectElement>("lang");

const voicePanel = bindSettingsPanel({
  getSettings: store.get,
  update: store.update,
  // The widget speaks it, so it sounds exactly as in conversation.
  onTestVoice: () => desktop?.sendToWidget({ type: "say", text: strings.voiceSample[store.get().lang] }),
});
bindMemoryPanel();
keepLoadingVoices(() => voicePanel.refresh());

const renderLang = () => {
  langSelect.value = store.get().lang;
  voicePanel.refresh();
};
renderLang();
langSelect.addEventListener("change", () => {
  store.update({ lang: langSelect.value as Lang });
  voicePanel.refresh();
});

// The widget changed the settings (the language from its menu or the conversation).
window.addEventListener("storage", () => {
  store.reload();
  renderLang();
});

// --- Widget options (kept by the main process) ----------------------------------

const always = byId<HTMLInputElement>("opt-always");
const muted = byId<HTMLInputElement>("opt-muted");
const onTop = byId<HTMLInputElement>("opt-on-top");
const bubble = byId<HTMLInputElement>("opt-bubble");
const scale = byId<HTMLInputElement>("opt-scale");
const scaleValue = byId<HTMLOutputElement>("opt-scale-value");
const hotkeyLabel = byId("hotkey-label");
const hotkeyChange = byId<HTMLButtonElement>("hotkey-change");
const hotkeyNote = byId("hotkey-note");

let capturing = false;

function render(options: WidgetStatus): void {
  always.checked = options.listenMode === "always";
  always.disabled = options.muted;
  muted.checked = options.muted;
  onTop.checked = options.alwaysOnTop;
  bubble.checked = options.showBubble;
  scale.value = String(Math.round(options.scale * 100));
  scaleValue.textContent = `${scale.value} %`;
  if (capturing) return;
  hotkeyLabel.textContent = options.hotkeyLabel ?? text.hotkeyNone;
  setHotkeyNote(
    options.hotkeyLabel === null
      ? text.hotkeyTaken
      : options.hotkeyMode === "toggle"
        ? text.hotkeyToggle
        : text.hotkeyHold,
    options.hotkeyLabel === null,
  );
}

function setHotkeyNote(note: string, error = false): void {
  hotkeyNote.textContent = note;
  hotkeyNote.classList.toggle("error", error);
}

async function set(patch: Partial<WidgetOptions>): Promise<WidgetStatus | null> {
  if (!desktop) return null;
  const result = await desktop.setOptions(patch);
  render(result);
  return result;
}

always.addEventListener("change", () => void set({ listenMode: always.checked ? "always" : "ptt" }));
muted.addEventListener("change", () => void set({ muted: muted.checked }));
onTop.addEventListener("change", () => void set({ alwaysOnTop: onTop.checked }));
bubble.addEventListener("change", () => void set({ showBubble: bubble.checked }));
scale.addEventListener("input", () => (scaleValue.textContent = `${scale.value} %`));
scale.addEventListener("change", () => void set({ scale: Number(scale.value) / 100 }));

// --- Choosing the push-to-talk key ---

/** An Electron accelerator for the pressed keys, or a reason it can't be used. */
function accelerator(event: KeyboardEvent): { key: string } | { error: string } | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null; // still choosing
  const code = event.code;
  const key =
    code === "Space"
      ? "Space"
      : /^Key[A-Z]$/.test(code)
        ? code.slice(3)
        : /^Digit\d$/.test(code)
          ? code.slice(5)
          : /^F\d{1,2}$/.test(code)
            ? code
            : null;
  if (!key) return { error: text.hotkeyUnsupported };
  const modifiers = [
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
  ].filter(Boolean);
  // A plain letter or space would fire whenever the user types.
  if (modifiers.length === 0 && !key.startsWith("F")) return { error: text.hotkeyNeedsModifier };
  return { key: [...modifiers, key].join("+") };
}

function stopCapture(): void {
  capturing = false;
  hotkeyLabel.classList.remove("capturing");
  hotkeyChange.textContent = text.hotkeyChange;
  window.removeEventListener("keydown", onCaptureKey, true);
}

async function onCaptureKey(event: KeyboardEvent): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    stopCapture();
    if (desktop) render(await desktop.getOptions());
    return;
  }
  const chosen = accelerator(event);
  if (!chosen) return;
  if ("error" in chosen) {
    setHotkeyNote(chosen.error, true);
    return;
  }
  stopCapture();
  const result = await set({ hotkey: chosen.key });
  if (result && result.hotkey !== chosen.key) setHotkeyNote(text.hotkeyRejected(chosen.key.replace(/\+/g, " + ")), true);
}

hotkeyChange.addEventListener("click", async () => {
  if (capturing) {
    stopCapture();
    if (desktop) render(await desktop.getOptions());
    return;
  }
  capturing = true;
  hotkeyLabel.classList.add("capturing");
  hotkeyLabel.textContent = text.hotkeyPress;
  hotkeyChange.textContent = text.hotkeyCancel;
  setHotkeyNote(text.hotkeyCaptureHint);
  window.addEventListener("keydown", onCaptureKey, true);
});

// --- The installed app: API key, Whisper, autostart ------------------------------

const setupSection = byId("app-setup");
const keyForm = byId<HTMLFormElement>("api-key-form");
const keyInput = byId<HTMLInputElement>("api-key");
const keySave = byId<HTMLButtonElement>("api-key-save");
const keyNote = byId("api-key-note");
const whisperDir = byId("whisper-dir");
const whisperNote = byId("whisper-note");
const autostart = byId<HTMLInputElement>("opt-autostart");

function setNote(el: HTMLElement, note: string, kind: "ok" | "error" | null = null): void {
  el.textContent = note;
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("error", kind === "error");
}

let keyBusy = false;

function renderSetup(setup: AppSetup): void {
  setupSection.hidden = !setup.managed;
  if (!keyBusy) setNote(keyNote, setup.hasKey ? text.keyStored : text.keyMissing, setup.hasKey ? null : "error");
  whisperDir.textContent = setup.whisperDir ?? text.whisperNone;
  whisperDir.title = setup.whisperDir ?? "";
  setNote(
    whisperNote,
    text.whisper[setup.whisper],
    setup.whisper === "running" || setup.whisper === "external" ? "ok" : setup.whisper === "starting" ? null : "error",
  );
  autostart.checked = setup.autostart === true;
  autostart.disabled = setup.autostart === null;
}

keyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktop || !keyInput.value.trim()) return;
  keyBusy = true;
  keySave.disabled = true;
  setNote(keyNote, text.keyChecking);
  try {
    const result = await desktop.setApiKey(keyInput.value);
    if (result.ok) {
      keyInput.value = "";
      setNote(keyNote, text.keySaved, "ok");
    } else {
      setNote(keyNote, text.keyErrors[result.reason], "error");
    }
  } finally {
    keyBusy = false;
    keySave.disabled = false;
  }
});

byId("whisper-choose").addEventListener("click", async () => {
  if (desktop) renderSetup(await desktop.chooseWhisperDir());
});
autostart.addEventListener("change", async () => {
  if (desktop) renderSetup(await desktop.setAutostart(autostart.checked));
});

// --- Conversation ------------------------------------------------------------------

const historyEl = byId("history");

function renderHistory(entries: HistoryEntry[]): void {
  const atBottom = historyEl.scrollHeight - historyEl.scrollTop - historyEl.clientHeight < 40;
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = text.historyEmpty;
    historyEl.replaceChildren(empty);
    return;
  }
  historyEl.replaceChildren(
    ...entries.map((entry) => {
      const msg = document.createElement("div");
      msg.className = `msg ${entry.who === "user" ? "user" : "assistant"}`;
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = entry.who === "user" ? strings.you : strings.avatar;
      const body = document.createElement("div");
      body.className = "body";
      body.textContent = entry.text;
      msg.append(who, body);
      return msg;
    }),
  );
  if (atBottom) historyEl.scrollTop = historyEl.scrollHeight;
}

byId("new-chat").addEventListener("click", () => desktop?.sendToWidget({ type: "newConversation" }));

// --- Start ---------------------------------------------------------------------------

if (desktop) {
  desktop.onCommand((command) => {
    if (command.type === "options") render(command.options);
    else if (command.type === "history") renderHistory(command.entries);
    else if (command.type === "setup") renderSetup(command.setup);
  });
  void desktop.getSetup().then(renderSetup);
  void desktop.getOptions().then(render);
  void desktop.getHistory().then(renderHistory);
} else {
  byId("desktop-only").hidden = false;
  for (const input of [always, muted, onTop, bubble, scale, hotkeyChange]) input.disabled = true;
  renderHistory([]);
}
