// Global push-to-talk: the key works whichever program has the focus.
// Electron's globalShortcut sees the key go down and keeps it from the focused
// program, but never sees it go up; uiohook-napi (a low-level keyboard hook)
// reports the release. Without uiohook the key toggles instead: press to
// talk, press again to send.
import { globalShortcut } from "electron";

type Uiohook = typeof import("uiohook-napi");
type HookKey = keyof Uiohook["UiohookKey"];

export interface PushToTalk {
  /** "hold" = talk while held; "toggle" = press to start and again to stop. */
  mode: "hold" | "toggle";
  /** The key in Finnish for menus and notices, e.g. "Ctrl+Välilyönti". */
  label: string;
}

/** Longest a press may last, in case a release goes unseen (an elevated
 *  program in focus hides key events from the hook). */
const MAX_HOLD_MS = 90_000;

const MODIFIERS: Record<string, { label: string; keys: HookKey[] }> = {
  control: { label: "Ctrl", keys: ["Ctrl", "CtrlRight"] },
  ctrl: { label: "Ctrl", keys: ["Ctrl", "CtrlRight"] },
  commandorcontrol: { label: "Ctrl", keys: ["Ctrl", "CtrlRight"] },
  cmdorctrl: { label: "Ctrl", keys: ["Ctrl", "CtrlRight"] },
  alt: { label: "Alt", keys: ["Alt", "AltRight"] },
  shift: { label: "Shift", keys: ["Shift", "ShiftRight"] },
  super: { label: "Win", keys: ["Meta", "MetaRight"] },
  meta: { label: "Win", keys: ["Meta", "MetaRight"] },
};

const KEY_LABELS: Record<string, string> = { Space: "Välilyönti" };

let hook: Uiohook | null | undefined; // undefined = not loaded yet
let handlers: { down(): void; up(): void } = { down() {}, up() {} };
let current: { accelerator: string; releaseCodes: Set<number> } | null = null;
let held = false;
let limit: NodeJS.Timeout | undefined;

function loadHook(): Uiohook | null {
  if (hook !== undefined) return hook;
  try {
    // A native module: loaded at run time so a missing binary only costs the release detection.
    hook = require("uiohook-napi") as Uiohook;
    hook.uIOhook.on("keyup", (event) => {
      if (held && current?.releaseCodes.has(event.keycode)) release();
    });
    hook.uIOhook.start();
  } catch (err) {
    console.warn("uiohook-napi unavailable; push-to-talk falls back to toggling", err);
    hook = null;
  }
  return hook;
}

function press(): void {
  held = true;
  limit = setTimeout(release, MAX_HOLD_MS);
  handlers.down();
}

function release(): void {
  if (!held) return;
  held = false;
  clearTimeout(limit);
  handlers.up();
}

/** What happens when the key goes down and up. */
export function onPushToTalk(next: { down(): void; up(): void }): void {
  handlers = next;
}

/** The key in Finnish, e.g. "Ctrl+Välilyönti". */
export function hotkeyLabel(accelerator: string): string {
  const parts = accelerator.split("+").map((p) => p.trim());
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1).map((m) => MODIFIERS[m.toLowerCase()]?.label ?? m);
  return [...modifiers, KEY_LABELS[key] ?? key].join("+");
}

/** Makes `accelerator` (e.g. "Control+Space") the push-to-talk key, replacing
 *  the previous one. Null if the key is invalid or another program has it;
 *  then no key is registered. */
export function setPushToTalk(accelerator: string): PushToTalk | null {
  release();
  if (current) globalShortcut.unregister(current.accelerator);
  current = null;

  const parts = accelerator.split("+").map((p) => p.trim());
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1).map((m) => MODIFIERS[m.toLowerCase()]);
  const lib = loadHook();
  const keyCode = lib?.UiohookKey[(key.length === 1 ? key.toUpperCase() : key) as HookKey];
  const hold = lib !== null && keyCode !== undefined;
  const releaseCodes = new Set<number>(
    lib && keyCode !== undefined
      ? [keyCode, ...modifiers.flatMap((m) => m?.keys.map((k) => lib.UiohookKey[k]) ?? [])]
      : [],
  );

  let registered = false;
  try {
    // Fires again and again while the key auto-repeats; only the first counts.
    registered = globalShortcut.register(accelerator, () => {
      if (!held) press();
      else if (!hold) release();
    });
  } catch (err) {
    console.warn(`Invalid push-to-talk key ${accelerator}`, err);
  }
  if (!registered) return null;
  current = { accelerator, releaseCodes };
  return { mode: hold ? "hold" : "toggle", label: hotkeyLabel(accelerator) };
}

export function stopPushToTalk(): void {
  release();
  globalShortcut.unregisterAll();
  current = null;
  hook?.uIOhook.stop();
  hook = undefined;
}
