// The Electron bridge (desktop/preload.ts); undefined in a normal browser.
import type { DesktopBridge } from "../../shared/desktop";

declare global {
  interface Window {
    avatarDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = window.avatarDesktop;
