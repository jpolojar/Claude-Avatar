// Electron shell for the avatar: a transparent, frameless desktop widget that
// shows only the character and a speech bubble. The server, Vite and Whisper
// run beside it (npm run widget). AVATAR_DESKTOP_MODE=window opens the full
// web app in a normal window instead.
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, session } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IPC, type DesktopCommand, type MenuState, type MicConfig } from "../shared/desktop.js";
import { registerPushToTalk, unregisterPushToTalk } from "./hotkey.js";

const APP_URL = process.env.AVATAR_WIDGET_URL || "http://localhost:5173";
const MODE = (process.env.AVATAR_DESKTOP_MODE || "widget").toLowerCase();
const RETRY_MS = 500;
const WIDGET_SIZE = { width: 340, height: 520 };
/** Push-to-talk, as an Electron accelerator. */
const PTT_KEY = process.env.AVATAR_PTT_KEY || "Control+Space";
// desktop/dist/main.cjs -> the project root.
const ICON = join(__dirname, "..", "..", "assets", "avatar.ico");

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
  listenMode: "always" | "ptt";
  muted: boolean;
  /** Size relative to WIDGET_SIZE; the page is zoomed by the same factor. */
  scale: number;
}

const SCALE_PRESETS = [0.5, 0.65, 0.8, 1] as const;
const MIN_SCALE = 0.4;
const MAX_SCALE = 1.2;
const SCALE_STEP = 0.05;

const scaledSize = (scale: number) => ({
  width: Math.round(WIDGET_SIZE.width * scale),
  height: Math.round(WIDGET_SIZE.height * scale),
});

const clampScale = (scale: number) => {
  const value = Number.isFinite(scale) ? scale : 0.8;
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 100) / 100;
};

const DEFAULT_STATE: WidgetState = { alwaysOnTop: true, listenMode: "always", muted: false, scale: 0.8 };

const statePath = () => join(app.getPath("userData"), "widget-state.json");

function loadState(): WidgetState {
  try {
    return { ...DEFAULT_STATE, ...(JSON.parse(readFileSync(statePath(), "utf8")) as Partial<WidgetState>) };
  } catch {
    return { ...DEFAULT_STATE };
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
  const size = scaledSize(state.scale);
  return { x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height };
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
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: "#12141a",
    webPreferences,
  });
  devShortcuts(win);
  loadWhenReady(win, "");
}

function createWidget(): void {
  const state = loadState();
  state.scale = clampScale(state.scale);
  const win = new BrowserWindow({
    ...scaledSize(state.scale),
    ...initialPosition(state),
    title: "Avatar",
    icon: ICON,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    maximizable: false,
    hasShadow: false,
    skipTaskbar: true, // reached from the tray icon instead
    alwaysOnTop: state.alwaysOnTop,
    webPreferences,
  });
  devShortcuts(win);
  // Clicks pass through until the page says the mouse is over the avatar or
  // the bubble; `forward` keeps mouse moves coming so it can tell.
  win.setIgnoreMouseEvents(true, { forward: true });
  loadWhenReady(win, "widget.html");

  const send = (command: DesktopCommand) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.command, command);
  };
  const remember = () => {
    const [x, y] = win.getPosition();
    saveState({ ...state, x, y });
  };

  // --- Size ---

  // The page is laid out for WIDGET_SIZE and zoomed to the window size.
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(state.scale));

  /** Resizes the widget around its bottom centre (where the avatar stands). */
  const applyScale = (scale: number) => {
    const next = clampScale(scale);
    if (next === state.scale) return;
    const { x, y, width, height } = win.getBounds();
    const size = scaledSize(next);
    state.scale = next;
    win.setBounds({
      x: Math.round(x + (width - size.width) / 2),
      y: y + height - size.height,
      ...size,
    });
    win.webContents.setZoomFactor(next);
    remember();
  };

  ipcMain.on(IPC.scaleBy, (_event, direction: 1 | -1) => applyScale(state.scale + direction * SCALE_STEP));

  // --- Mouse: click-through and dragging ---

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

  // --- Microphone and push-to-talk ---

  const ptt = registerPushToTalk(PTT_KEY, {
    down: () => send({ type: "ptt", down: true }),
    up: () => send({ type: "ptt", down: false }),
  });
  if (!ptt) console.warn(`Push-to-talk key ${PTT_KEY} is taken by another program`);

  const micConfig = (): MicConfig => ({ mode: state.listenMode, muted: state.muted, hotkey: ptt?.label ?? null });
  const setMic = (patch: Partial<Pick<WidgetState, "listenMode" | "muted">>) => {
    Object.assign(state, patch);
    remember();
    send({ type: "mic", config: micConfig() });
    updateTray();
  };
  ipcMain.handle(IPC.getMicConfig, () => micConfig());

  // --- Menus (right-click on the avatar and the tray icon) ---

  let page: MenuState = { lang: "fi" };
  ipcMain.on(IPC.reportState, (_event, next: MenuState) => {
    page = next;
  });

  const toggleVisible = () => {
    if (win.isVisible()) win.hide();
    else win.showInactive();
  };

  const buildMenu = (fromTray: boolean) =>
    Menu.buildFromTemplate([
      ...(fromTray
        ? [{ label: win.isVisible() ? "Piilota avatar" : "Näytä avatar", click: toggleVisible }, { type: "separator" as const }]
        : []),
      { label: "Keskeytä", click: () => send({ type: "stop" }) },
      { label: "Uusi keskustelu", click: () => send({ type: "newConversation" }) },
      { type: "separator" },
      {
        label: "Jatkuva kuuntelu",
        type: "checkbox",
        checked: state.listenMode === "always",
        enabled: !state.muted,
        click: (item) => setMic({ listenMode: item.checked ? "always" : "ptt" }),
      },
      {
        label: "Mykistä mikrofoni",
        type: "checkbox",
        checked: state.muted,
        click: (item) => setMic({ muted: item.checked }),
      },
      ptt
        ? { label: `Puhu: pidä ${ptt.label} pohjassa`, enabled: false }
        : { label: `Pikanäppäin ${PTT_KEY} on varattu`, enabled: false },
      { type: "separator" },
      {
        label: "Kieli",
        submenu: [
          { label: "Suomi", type: "radio", checked: page.lang === "fi", click: () => send({ type: "lang", lang: "fi" }) },
          { label: "English", type: "radio", checked: page.lang === "en", click: () => send({ type: "lang", lang: "en" }) },
        ],
      },
      {
        label: "Koko",
        submenu: SCALE_PRESETS.map((preset) => ({
          label: `${Math.round(preset * 100)} %`,
          type: "radio" as const,
          checked: Math.abs(state.scale - preset) < 0.001,
          click: () => applyScale(preset),
        })),
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
    ]);

  ipcMain.on(IPC.showMenu, () => buildMenu(false).popup({ window: win }));

  const tray = new Tray(nativeImage.createFromPath(ICON));
  function updateTray(): void {
    const mic = state.muted ? "mikrofoni mykistetty" : state.listenMode === "always" ? "kuuntelee" : "vain pikanäppäin";
    tray.setToolTip(`Avatar – ${mic}${ptt && !state.muted ? ` (puhu: ${ptt.label})` : ""}`);
  }
  updateTray();
  tray.on("click", toggleVisible);
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu(true)));
  app.on("will-quit", () => {
    unregisterPushToTalk();
    tray.destroy();
  });
}

// Two copies would fight over the hotkey and the microphone: show the first one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => BrowserWindow.getAllWindows()[0]?.showInactive());
  app.whenReady().then(() => {
    // The page is our own local app: allow the microphone without a prompt.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media"));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
    if (MODE === "window") createFullWindow();
    else createWidget();
  });
}

app.on("window-all-closed", () => app.quit());
