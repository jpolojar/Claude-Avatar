// The narrow bridge between the app's pages (the widget and the settings
// window) and the Electron main process (exposed by desktop/preload.ts as
// window.avatarDesktop).
import type { Lang } from "./protocol.js";

/** The page the widget is laid out for; the window is this size times `scale`. */
export const WIDGET_SIZE = { width: 340, height: 520 } as const;
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 1.2;

/** Page state the menus show (the context menu and the tray menu). */
export interface MenuState {
  lang: Lang;
}

/** Widget options kept by the main process, set from the menus and the settings window. */
export interface WidgetOptions {
  /** always = listens all the time (VAD); ptt = only while the hotkey is held. */
  listenMode: "always" | "ptt";
  /** Microphone off altogether, the hotkey included. */
  muted: boolean;
  alwaysOnTop: boolean;
  /** Size relative to WIDGET_SIZE. */
  scale: number;
  /** Show what the avatar says in a speech bubble. */
  showBubble: boolean;
  /** Push-to-talk key as an Electron accelerator, e.g. "Control+Space". */
  hotkey: string;
}

export interface WidgetStatus extends WidgetOptions {
  /** The hotkey as shown to the user, e.g. "Ctrl+Välilyönti"; null if another program has it. */
  hotkeyLabel: string | null;
  /** hold = talk while held; toggle = press to start and again to stop (no key-up hook). */
  hotkeyMode: "hold" | "toggle" | null;
}

/** The installed app's own setup (the development setup uses .env and npm scripts). */
export interface AppSetup {
  /** The app runs its own server: the API key, Whisper and autostart are set here. */
  managed: boolean;
  hasKey: boolean;
  whisperDir: string | null;
  whisper: "running" | "starting" | "missing" | "failed" | "external";
  /** Start with Windows; null when unavailable (development). */
  autostart: boolean | null;
}

export type ApiKeyResult = { ok: true } | { ok: false; reason: "invalid" | "rejected" | "network" | "storage" };

export interface HistoryEntry {
  who: "user" | "avatar";
  text: string;
}

/** Commands the main process sends to the pages. */
export type DesktopCommand =
  | { type: "lang"; lang: Lang }
  | { type: "newConversation" }
  | { type: "stop" }
  /** Speak a line without asking Claude (voice test from the settings window). */
  | { type: "say"; text: string }
  | { type: "options"; options: WidgetStatus }
  | { type: "history"; entries: HistoryEntry[] }
  | { type: "setup"; setup: AppSetup }
  /** The global push-to-talk key went down or up. */
  | { type: "ptt"; down: boolean };

/** Commands the settings window may pass on to the widget. */
export type WidgetCommand = Extract<DesktopCommand, { type: "newConversation" | "stop" | "say" }>;

export interface DesktopBridge {
  // --- Widget window ---
  /** false = clicks pass through the window to whatever is below. */
  setInteractive(interactive: boolean): void;
  /** Start moving the window with the mouse until endDrag(). */
  startDrag(): void;
  endDrag(): void;
  showMenu(): void;
  /** Keeps the menus up to date with the page. */
  reportState(state: MenuState): void;
  /** The conversation so far, for the settings window's history view. */
  reportHistory(entries: HistoryEntry[]): void;
  /** Grow (+1) or shrink (-1) the widget by one step. */
  scaleBy(direction: 1 | -1): void;

  // --- Both pages ---
  getOptions(): Promise<WidgetStatus>;
  openSettings(): void;
  onCommand(listener: (command: DesktopCommand) => void): void;

  // --- Settings window ---
  /** Applies the change and resolves with the result (a taken hotkey is not applied). */
  setOptions(patch: Partial<WidgetOptions>): Promise<WidgetStatus>;
  getHistory(): Promise<HistoryEntry[]>;
  sendToWidget(command: WidgetCommand): void;
  getSetup(): Promise<AppSetup>;
  /** Checks the key with Claude and stores it encrypted; never read back by the pages. */
  setApiKey(key: string): Promise<ApiKeyResult>;
  /** Opens a folder picker for whisper.cpp and starts it from there. */
  chooseWhisperDir(): Promise<AppSetup>;
  setAutostart(on: boolean): Promise<AppSetup>;
}

export const IPC = {
  setInteractive: "avatar:set-interactive",
  startDrag: "avatar:start-drag",
  endDrag: "avatar:end-drag",
  showMenu: "avatar:show-menu",
  reportState: "avatar:report-state",
  reportHistory: "avatar:report-history",
  scaleBy: "avatar:scale-by",
  getOptions: "avatar:get-options",
  setOptions: "avatar:set-options",
  getHistory: "avatar:get-history",
  openSettings: "avatar:open-settings",
  sendToWidget: "avatar:send-to-widget",
  getSetup: "avatar:get-setup",
  setApiKey: "avatar:set-api-key",
  chooseWhisperDir: "avatar:choose-whisper-dir",
  setAutostart: "avatar:set-autostart",
  command: "avatar:command",
} as const;
