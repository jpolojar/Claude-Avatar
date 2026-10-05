// Electron shell for the avatar (phase 1): shows the existing web app in a
// desktop window. The server, Vite and Whisper run beside it (npm run widget).
import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";

const APP_URL = process.env.AVATAR_WIDGET_URL || "http://localhost:5173";
const RETRY_MS = 500;

// Chrome cancels the echo of everything the browser plays (not only WebRTC
// audio) behind these features; Electron does not get Chrome's field trials,
// so they are switched on explicitly. AVATAR_ELECTRON_FEATURES overrides the
// list ("" = none) for comparing echo cancellation setups.
const features = process.env.AVATAR_ELECTRON_FEATURES ?? "ChromeWideEchoCancellation";
if (features.trim()) app.commandLine.appendSwitch("enable-features", features);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Avatar",
    icon: join(app.getAppPath(), "assets", "avatar.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#12141a",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      // Speech may start without a click in the page (always-on listening).
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // F12 opens the developer tools, Ctrl+R reloads.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") win.webContents.toggleDevTools();
    else if (input.control && input.key.toLowerCase() === "r") win.webContents.reload();
    else return;
    event.preventDefault();
  });

  // The dev servers may still be starting. Wait until the API answers too:
  // a page loaded before it would miss the server voices and fall back to the
  // browser's own voice, which the echo canceller cannot remove.
  const load = async () => {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await win.loadURL(APP_URL);
    } catch {
      setTimeout(load, RETRY_MS);
    }
  };
  void load();
  return win;
}

app.whenReady().then(() => {
  // The page is our own local app: allow the microphone without a prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  createWindow();
});

app.on("window-all-closed", () => app.quit());
