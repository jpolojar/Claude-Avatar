// The narrow bridge between the widget page and the Electron main process
// (exposed by desktop/preload.ts as window.avatarDesktop).
import type { Lang } from "./protocol.js";

/** What the context menu shows and acts on. */
export interface MenuState {
  lang: Lang;
}

/** Commands the main process sends to the widget (from the menu). */
export type DesktopCommand = { type: "lang"; lang: Lang } | { type: "newConversation" } | { type: "stop" };

export interface DesktopBridge {
  /** false = clicks pass through the window to whatever is below. */
  setInteractive(interactive: boolean): void;
  /** Start moving the window with the mouse until endDrag(). */
  startDrag(): void;
  endDrag(): void;
  showMenu(state: MenuState): void;
  onCommand(listener: (command: DesktopCommand) => void): void;
}

export const IPC = {
  setInteractive: "avatar:set-interactive",
  startDrag: "avatar:start-drag",
  endDrag: "avatar:end-drag",
  showMenu: "avatar:show-menu",
  command: "avatar:command",
} as const;
