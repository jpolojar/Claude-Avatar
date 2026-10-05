// The desktop widget page: only the avatar, a speech bubble and a status pill
// on a transparent window. Runs inside Electron (desktop/main.ts); opened in
// a normal browser it still works, just without click-through and dragging.
import type { DesktopBridge, DesktopCommand, MicConfig } from "../../../shared/desktop";
import { fetchHealth } from "../api";
import { App, type AppState } from "../app";
import { Avatar } from "../avatar/avatar";
import { createSettingsStore, createSpeaker, keepLoadingVoices } from "../core";
import type { AssistantBubble, ConversationLog } from "../ui/chat-log";
import { byId } from "../ui/dom";
import { strings } from "../ui/strings";

declare global {
  interface Window {
    avatarDesktop?: DesktopBridge;
  }
}

const bridge = window.avatarDesktop;
const stage = byId("stage");
const bubble = byId("bubble");
const heard = byId("heard");
const statusEl = byId("status");
const statusText = byId("status-text");

const BUBBLE_HOLD_MS = 4000; // after the avatar stops talking
const HEARD_HOLD_MS = 3500;
const NOTICE_HOLD_MS = 9000;

// --- Speech bubble -------------------------------------------------------------------

let bubbleTimer: ReturnType<typeof setTimeout> | undefined;

function showBubble(text: string, warning = false): void {
  clearTimeout(bubbleTimer);
  bubble.textContent = text;
  bubble.classList.toggle("warning", warning);
  bubble.classList.remove("fading");
  bubble.hidden = false;
}

function hideBubble(afterMs: number): void {
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.classList.add("fading");
    bubbleTimer = setTimeout(() => (bubble.hidden = true), 400);
  }, afterMs);
}

let heardTimer: ReturnType<typeof setTimeout> | undefined;

function showHeard(text: string): void {
  clearTimeout(heardTimer);
  heard.textContent = `”${text}”`;
  heard.hidden = false;
  heardTimer = setTimeout(() => (heard.hidden = true), HEARD_HOLD_MS);
}

/** Keeps the conversation for the history view (phase 4); the bubble shows it live. */
class WidgetLog implements ConversationLog {
  readonly entries: { who: "user" | "avatar"; text: string }[] = [];

  clear(): void {
    this.entries.length = 0;
  }

  addUser(text: string): () => void {
    const entry = { who: "user" as const, text };
    this.entries.push(entry);
    showHeard(text);
    return () => {
      const i = this.entries.indexOf(entry);
      if (i >= 0) this.entries.splice(i, 1);
      heard.hidden = true;
    };
  }

  addAssistant(): AssistantBubble {
    const entry = { who: "avatar" as const, text: "" };
    this.entries.push(entry);
    return {
      append: (text) => (entry.text += text),
      set: (text) => (entry.text = text),
      note: () => {},
      error: (text) => showBubble(text, true),
      remove: () => {
        const i = this.entries.indexOf(entry);
        if (i >= 0) this.entries.splice(i, 1);
      },
    };
  }
}

// --- Status pill ---------------------------------------------------------------------

let appState: AppState = "idle";
let searchQuery: string | null = null;
let statusNote: string | null = null; // e.g. "speech recognition starting"

function renderStatus(): void {
  statusEl.dataset.state = appState;
  statusText.textContent =
    statusNote ??
    (appState === "thinking" && searchQuery !== null
      ? strings.searching(searchQuery)
      : appState === "listening" || appState === "thinking"
        ? strings.status[appState]
        : "");
}

// --- App -------------------------------------------------------------------------------

const store = createSettingsStore();
window.addEventListener("storage", () => {
  store.reload(); // another app window changed settings
  reportState();
});

const avatar = new Avatar(stage, { distance: 1.15, lift: 0.1 });
avatar.load("/models/avatar.vrm").catch((err: unknown) => {
  console.warn("Avatar model failed to load", err);
  showBubble(strings.avatarMissing, true);
});

const speaker = createSpeaker(store, (text) => {
  showBubble(text, true);
  hideBubble(NOTICE_HOLD_MS);
});
keepLoadingVoices(() => {});

const log = new WidgetLog();
const app = new App(
  {
    log,
    setState: (state) => {
      appState = state;
      avatar.setState(state);
      renderStatus();
      if (state === "listening") hideBubble(600);
      else if (state === "idle") hideBubble(BUBBLE_HOLD_MS);
    },
    setInterim: () => {},
    setDebug: (text) => text && console.debug(text),
    showNotice: (text) => {
      if (!text) return;
      showBubble(text, true);
      hideBubble(NOTICE_HOLD_MS);
    },
    setLanguage: (lang) => {
      store.update({ lang });
      reportState();
    },
    setSpeaking: (engine) => avatar.setMouthSource(engine === null ? null : engine === "browser" ? "procedural" : "audio"),
    setEmotion: (emotion) => avatar.setEmotion(emotion),
    setSearch: (query) => {
      searchQuery = query;
      renderStatus();
    },
    showSentence: (text) => showBubble(text),
  },
  store.get,
  speaker,
  { pttStt: "whisper" }, // Electron has no Web Speech
);

if (import.meta.env.DEV) Object.assign(window, { avatar, app });

window.addEventListener("pagehide", () => app.endConversation());

// --- Microphone ------------------------------------------------------------------------

/** Set from the tray or the context menu; in a plain browser always-on is the default. */
let mic: MicConfig = { mode: "always", muted: false, hotkey: null };
let whisperReady = false;

async function applyMic(): Promise<void> {
  const config = mic;
  if (config.muted) {
    await app.setListenMode("ptt");
    app.releaseMic();
    statusNote = strings.widget.muted;
    renderStatus();
    return;
  }
  if (!whisperReady) return; // started once Whisper answers
  try {
    await app.setListenMode(config.mode);
    await app.prepareMic();
    statusNote = config.mode === "ptt" && config.hotkey ? strings.widget.holdToTalk(config.hotkey) : null;
  } catch (err) {
    statusNote = strings.widget.micOff;
    showBubble(strings.micFailed(err instanceof Error ? err.message : String(err)), true);
  }
  renderStatus();
}

// Listening needs local Whisper, which takes a few seconds to load.
async function startListening(): Promise<void> {
  if (bridge) mic = await bridge.getMicConfig();
  if (!mic.muted) {
    statusNote = strings.widget.sttStarting;
    renderStatus();
  }
  while (!(await fetchHealth())?.whisper) await new Promise((r) => setTimeout(r, 3000));
  whisperReady = true;
  await applyMic();
}
void startListening();

/** The global push-to-talk key (desktop/hotkey.ts). */
function onPushToTalk(down: boolean): void {
  if (!down) {
    app.stopListening();
    return;
  }
  if (mic.muted || !whisperReady) {
    showBubble(mic.muted ? strings.widget.mutedHint : strings.widget.sttStarting, true);
    hideBubble(2500);
    return;
  }
  app.startListening();
}

// --- Desktop: click-through, dragging, menu ----------------------------------------

/** Clicks only belong to the widget over the avatar or its bubble/status; elsewhere they pass through. */
let interactive = false;
let probing = false;
let pointerDown: { x: number; y: number } | null = null;
let dragging = false;

function setInteractive(on: boolean): void {
  if (on === interactive) return;
  interactive = on;
  bridge?.setInteractive(on);
}

window.addEventListener("mousemove", async (event) => {
  if (pointerDown || probing) return;
  probing = true;
  try {
    const target = event.target as Node | null;
    const overUi = (!bubble.hidden && bubble.contains(target)) || statusEl.contains(target);
    const alpha = overUi ? 1 : await avatar.alphaAt(event.clientX, event.clientY);
    setInteractive(alpha > 0.15);
  } finally {
    probing = false;
  }
});
document.documentElement.addEventListener("mouseleave", () => {
  if (!pointerDown) setInteractive(false);
});

window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointerDown = { x: event.screenX, y: event.screenY };
  document.documentElement.setPointerCapture(event.pointerId);
});
window.addEventListener("pointermove", (event) => {
  if (!pointerDown || dragging) return;
  if (Math.hypot(event.screenX - pointerDown.x, event.screenY - pointerDown.y) > 4) {
    dragging = true;
    bridge?.startDrag();
  }
});
window.addEventListener("pointerup", () => {
  if (dragging) bridge?.endDrag();
  else if (pointerDown) app.stop(); // a click on the avatar interrupts it
  pointerDown = null;
  dragging = false;
});

// The mouse wheel over the avatar resizes the widget (throttled: one step per notch).
let lastWheel = 0;
window.addEventListener(
  "wheel",
  (event) => {
    if (!interactive || event.deltaY === 0) return;
    event.preventDefault();
    if (event.timeStamp - lastWheel < 60) return;
    lastWheel = event.timeStamp;
    bridge?.scaleBy(event.deltaY < 0 ? 1 : -1);
  },
  { passive: false },
);

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  bridge?.showMenu();
});

bridge?.onCommand((command: DesktopCommand) => {
  switch (command.type) {
    case "stop":
      app.stop();
      break;
    case "newConversation":
      app.newConversation();
      hideBubble(0);
      break;
    case "lang":
      store.update({ lang: command.lang });
      reportState();
      break;
    case "mic":
      mic = command.config;
      void applyMic();
      break;
    case "ptt":
      onPushToTalk(command.down);
      break;
  }
});

/** Keeps the menus in the main process showing the current language. */
function reportState(): void {
  bridge?.reportState({ lang: store.get().lang });
}
reportState();
