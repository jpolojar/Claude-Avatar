// The narrow bridge between the widget page and the Electron main process
// (exposed by desktop/preload.ts as window.avatarDesktop).
import type { Lang } from "./protocol.js";

/** Page state the menus show (the context menu and the tray menu). */
export interface MenuState {
  lang: Lang;
}

/** How the widget listens; kept by the main process, changed from the menus. */
export interface MicConfig {
  /** always = listens all the time (VAD); ptt = only while the hotkey is held. */
  mode: "always" | "ptt";
  /** Microphone off altogether, the hotkey included. */
  muted: boolean;
  /** The push-to-talk key as shown to the user, e.g. "Ctrl+Välilyönti"; null if none. */
  hotkey: string | null;
}

/** Commands the main process sends to the widget. */
export type DesktopCommand =
  | { type: "lang"; lang: Lang }
  | { type: "newConversation" }
  | { type: "stop" }
  | { type: "mic"; config: MicConfig }
  /** The global push-to-talk key went down or up. */
  | { type: "ptt"; down: boolean };

export interface DesktopBridge {
  /** false = clicks pass through the window to whatever is below. */
  setInteractive(interactive: boolean): void;
  /** Start moving the window with the mouse until endDrag(). */
  startDrag(): void;
  endDrag(): void;
  showMenu(): void;
  /** Keeps the menus up to date with the page. */
  reportState(state: MenuState): void;
  getMicConfig(): Promise<MicConfig>;
  /** Grow (+1) or shrink (-1) the widget by one step. */
  scaleBy(direction: 1 | -1): void;
  onCommand(listener: (command: DesktopCommand) => void): void;
}

export const IPC = {
  setInteractive: "avatar:set-interactive",
  startDrag: "avatar:start-drag",
  endDrag: "avatar:end-drag",
  showMenu: "avatar:show-menu",
  reportState: "avatar:report-state",
  getMicConfig: "avatar:get-mic-config",
  scaleBy: "avatar:scale-by",
  command: "avatar:command",
} as const;
