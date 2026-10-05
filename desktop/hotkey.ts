// Global push-to-talk: the key works whichever program has the focus.
// Electron's globalShortcut sees the key go down and keeps it from the focused
// program, but never sees it go up; uiohook-napi (a low-level keyboard hook)
// reports the release. Without uiohook the key toggles instead: press to
// talk, press again to send.
import { globalShortcut } from "electron";

type Uiohook = typeof import("uiohook-napi");

export interface PushToTalk {
  /** "hold" = talk while held; "toggle" = press to start and again to stop. */
  mode: "hold" | "toggle";
  /** The key in Finnish for menus and notices, e.g. "Ctrl+Välilyönti". */
  label: string;
}

/** Longest a press may last, in case a release goes unseen (an elevated
 *  program in focus hides key events from the hook). */
const MAX_HOLD_MS = 90_000;

const MODIFIERS: Record<string, { label: string; keys: (keyof Uiohook["UiohookKey"])[] }> = {
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

let runningHook: Uiohook | null = null;

function loadHook(): Uiohook | null {
  try {
    // A native module: loaded at run time so a missing binary only costs the release detection.
    return require("uiohook-napi") as Uiohook;
  } catch (err) {
    console.warn("uiohook-napi unavailable; push-to-talk falls back to toggling", err);
    return null;
  }
}

/** Registers the key (an Electron accelerator such as "Control+Space"); null if it is taken. */
export function registerPushToTalk(
  accelerator: string,
  handlers: { down(): void; up(): void },
): PushToTalk | null {
  const parts = accelerator.split("+").map((p) => p.trim());
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1).map((m) => MODIFIERS[m.toLowerCase()]);
  const label = [...modifiers.map((m) => m?.label ?? "?"), KEY_LABELS[key] ?? key].join("+");

  const hook = loadHook();
  const keyCode = hook?.UiohookKey[(key.length === 1 ? key.toUpperCase() : key) as keyof Uiohook["UiohookKey"]];
  const releaseCodes = new Set<number>(
    keyCode === undefined ? [] : [keyCode, ...modifiers.flatMap((m) => m?.keys.map((k) => hook!.UiohookKey[k]) ?? [])],
  );
  const hold = hook !== null && keyCode !== undefined;

  let held = false;
  let limit: NodeJS.Timeout | undefined;
  const press = () => {
    held = true;
    limit = setTimeout(release, MAX_HOLD_MS);
    handlers.down();
  };
  const release = () => {
    if (!held) return;
    held = false;
    clearTimeout(limit);
    handlers.up();
  };

  // Fires again and again while the key auto-repeats; only the first counts.
  const registered = globalShortcut.register(accelerator, () => {
    if (!held) press();
    else if (!hold) release();
  });
  if (!registered) return null;

  if (hold && hook) {
    hook.uIOhook.on("keyup", (event) => {
      if (held && releaseCodes.has(event.keycode)) release();
    });
    hook.uIOhook.start();
    runningHook = hook;
  }
  return { mode: hold ? "hold" : "toggle", label };
}

export function unregisterPushToTalk(): void {
  globalShortcut.unregisterAll();
  runningHook?.uIOhook.stop();
  runningHook = null;
}
