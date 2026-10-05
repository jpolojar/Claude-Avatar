// Electron shell for the avatar: a transparent, frameless desktop widget that
// shows only the character and a speech bubble. The server, Vite and Whisper
// run beside it (npm run widget). AVATAR_DESKTOP_MODE=window opens the full
// web app in a normal window instead.
import { BrowserWindow, Menu, app, ipcMain, screen, session } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IPC, type DesktopCommand, type MenuState } from "../shared/desktop.js";

const APP_URL = process.env.AVATAR_WIDGET_URL || "http://localhost:5173";
const MODE = (process.env.AVATAR_DESKTOP_MODE || "widget").toLowerCase();
const RETRY_MS = 500;
const WIDGET_SIZE = { width: 340, height: 520 };

// Chrome cancels the echo of everything the browser plays (not only WebRTC
// audio) behind these features; Electron does not get Chrome's field trials,
// so they are switched on explicitly. AVATAR_ELECTRON_FEATURES overrides the
// list ("" = none) for comparing echo cancellation setups.
const features = process.env.AVATAR_ELECTRON_FEATURES ?? "ChromeWideEchoCancellation";
if (features.trim()) app.commandLine.appendSwitch("enable-features", features);

const webPreferences = {
  contextIsolation: true,
  sandbox: true,
  // Speech may start without a click in the page (always-on listening).
  autoplayPolicy: "no-user-gesture-required" as const,
  preload: join(__dirname, "preload.cjs"),
};

// --- Widget position and options, remembered between runs ---------------------

interface WidgetState {
  x?: number;
  y?: number;
  alwaysOnTop: boolean;
}

const statePath = () => join(app.getPath("userData"), "widget-state.json");

function loadState(): WidgetState {
  try {
    return { alwaysOnTop: true, ...(JSON.parse(readFileSync(statePath(), "utf8")) as Partial<WidgetState>) };
  } catch {
    return { alwaysOnTop: true };
  }
}

function saveState(state: WidgetState): void {
  try {
    writeFileSync(statePath(), JSON.stringify(state));
  } catch (err) {
    console.warn("Could not save the widget position", err);
  }
}

/** The saved position if it is still on a screen, else the bottom-right corner. */
function initialPosition(state: WidgetState): { x: number; y: number } {
  if (state.x !== undefined && state.y !== undefined) {
    const visible = screen.getAllDisplays().some(({ workArea: a }) => {
      return state.x! + 50 > a.x && state.x! < a.x + a.width - 50 && state.y! >= a.y && state.y! < a.y + a.height - 50;
    });
    if (visible) return { x: state.x, y: state.y };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - WIDGET_SIZE.width - 24, y: area.y + area.height - WIDGET_SIZE.height };
}

// --- Windows ------------------------------------------------------------------------

function devShortcuts(win: BrowserWindow): void {
  // F12 opens the developer tools, Ctrl+R reloads.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: "detach" });
    }
    else if (input.control && input.key.toLowerCase() === "r") win.webContents.reload();
    else return;
    event.preventDefault();
  });
}

/** Loads the page once the dev servers answer (a page loaded before the API
 *  would miss the server voices and fall back to the browser voice). */
function loadWhenReady(win: BrowserWindow, page: string): void {
  const load = async () => {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await win.loadURL(`${APP_URL}/${page}`);
    } catch {
      if (!win.isDestroyed()) setTimeout(load, RETRY_MS);
    }
  };
  void load();
}

function createFullWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Avatar",
    icon: join(app.getAppPath(), "assets", "avatar.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#12141a",
    webPreferences,
  });
  devShortcuts(win);
  loadWhenReady(win, "");
}

function createWidget(): void {
  const state = loadState();
  const win = new BrowserWindow({
    ...WIDGET_SIZE,
    ...initialPosition(state),
    title: "Avatar",
    icon: join(app.getAppPath(), "assets", "avatar.ico"),
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    maximizable: false,
    hasShadow: false,
    alwaysOnTop: state.alwaysOnTop,
    webPreferences,
  });
  devShortcuts(win);
  // Clicks pass through until the page says the mouse is over the avatar or
  // the bubble; `forward` keeps mouse moves coming so it can tell.
  win.setIgnoreMouseEvents(true, { forward: true });
  loadWhenReady(win, "widget.html");

  const send = (command: DesktopCommand) => win.webContents.send(IPC.command, command);
  const remember = () => {
    const [x, y] = win.getPosition();
    saveState({ ...state, x, y });
  };

  ipcMain.on(IPC.setInteractive, (_event, interactive: boolean) => {
    if (interactive) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  });

  // Dragging follows the cursor from the main process, so it keeps working
  // when the mouse runs ahead of the window.
  let dragTimer: NodeJS.Timeout | undefined;
  ipcMain.on(IPC.startDrag, () => {
    clearInterval(dragTimer);
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const offset = { x: cursor.x - wx, y: cursor.y - wy };
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      win.setPosition(p.x - offset.x, p.y - offset.y);
    }, 16);
  });
  ipcMain.on(IPC.endDrag, () => {
    clearInterval(dragTimer);
    dragTimer = undefined;
    remember();
  });

  ipcMain.on(IPC.showMenu, (_event, menuState: MenuState) => {
    Menu.buildFromTemplate([
      { label: "Keskeytä", click: () => send({ type: "stop" }) },
      { label: "Uusi keskustelu", click: () => send({ type: "newConversation" }) },
      { type: "separator" },
      {
        label: "Kieli",
        submenu: [
          { label: "Suomi", type: "radio", checked: menuState.lang === "fi", click: () => send({ type: "lang", lang: "fi" }) },
          { label: "English", type: "radio", checked: menuState.lang === "en", click: () => send({ type: "lang", lang: "en" }) },
        ],
      },
      {
        label: "Aina päällimmäisenä",
        type: "checkbox",
        checked: state.alwaysOnTop,
        click: (item) => {
          state.alwaysOnTop = item.checked;
          win.setAlwaysOnTop(item.checked);
          remember();
        },
      },
      { label: "Kehittäjätyökalut", click: () => win.webContents.openDevTools({ mode: "detach" }) },
      { type: "separator" },
      { label: "Lopeta", click: () => app.quit() },
    ]).popup({ window: win });
  });
}

app.whenReady().then(() => {
  // The page is our own local app: allow the microphone without a prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  if (MODE === "window") createFullWindow();
  else createWidget();
});

app.on("window-all-closed", () => app.quit());
