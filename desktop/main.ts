// Electron shell for the avatar: a transparent, frameless desktop widget that
// shows only the character and a speech bubble, a tray icon, a settings
// window and the global push-to-talk key. The server, Vite and Whisper run
// beside it (npm run widget). AVATAR_DESKTOP_MODE=window opens the full web
// app in a normal window instead.
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, session } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  IPC,
  MAX_SCALE,
  MIN_SCALE,
  WIDGET_SIZE,
  type DesktopCommand,
  type HistoryEntry,
  type MenuState,
  type WidgetCommand,
  type WidgetOptions,
  type WidgetStatus,
} from "../shared/desktop.js";
import { onPushToTalk, setPushToTalk, stopPushToTalk, type PushToTalk } from "./hotkey.js";

const APP_URL = process.env.AVATAR_WIDGET_URL || "http://localhost:5173";
const MODE = (process.env.AVATAR_DESKTOP_MODE || "widget").toLowerCase();
const RETRY_MS = 500;
const DEFAULT_HOTKEY = "Control+Space";
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

interface SavedState extends WidgetOptions {
  x?: number;
  y?: number;
}

const SCALE_PRESETS = [0.5, 0.65, 0.8, 1] as const;
const SCALE_STEP = 0.05;

const DEFAULT_STATE: SavedState = {
  listenMode: "always",
  muted: false,
  alwaysOnTop: true,
  scale: 0.8,
  showBubble: true,
  hotkey: DEFAULT_HOTKEY,
};

const scaledSize = (scale: number) => ({
  width: Math.round(WIDGET_SIZE.width * scale),
  height: Math.round(WIDGET_SIZE.height * scale),
});

const clampScale = (scale: unknown) => {
  const value = typeof scale === "number" && Number.isFinite(scale) ? scale : DEFAULT_STATE.scale;
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 100) / 100;
};

const statePath = () => join(app.getPath("userData"), "widget-state.json");

function loadState(): SavedState {
  let saved: Partial<SavedState> = {};
  try {
    saved = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<SavedState>;
  } catch {
    // first run
  }
  const state = { ...DEFAULT_STATE, ...saved, scale: clampScale(saved.scale) };
  // AVATAR_PTT_KEY wins over a key chosen in the settings window.
  if (process.env.AVATAR_PTT_KEY) state.hotkey = process.env.AVATAR_PTT_KEY;
  return state;
}

function saveState(state: SavedState): void {
  try {
    writeFileSync(statePath(), JSON.stringify(state));
  } catch (err) {
    console.warn("Could not save the widget state", err);
  }
}

/** Only well-formed fields of a patch from a page. */
function sanitize(patch: Partial<WidgetOptions>): Partial<WidgetOptions> {
  const clean: Partial<WidgetOptions> = {};
  if (patch.listenMode === "always" || patch.listenMode === "ptt") clean.listenMode = patch.listenMode;
  if (typeof patch.muted === "boolean") clean.muted = patch.muted;
  if (typeof patch.alwaysOnTop === "boolean") clean.alwaysOnTop = patch.alwaysOnTop;
  if (typeof patch.showBubble === "boolean") clean.showBubble = patch.showBubble;
  if (typeof patch.scale === "number") clean.scale = clampScale(patch.scale);
  if (typeof patch.hotkey === "string" && /^[\w+]{1,40}$/.test(patch.hotkey)) clean.hotkey = patch.hotkey;
  return clean;
}

/** The saved position if it is still on a screen, else the bottom-right corner. */
function initialPosition(state: SavedState): { x: number; y: number } {
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
  // Pages scale themselves; undo a zoom level Chromium remembers for the origin
  // (it is shared by every window of the origin).
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(1));
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

  let settingsWin: BrowserWindow | null = null;

  const send = (target: BrowserWindow | null, command: DesktopCommand) => {
    if (target && !target.isDestroyed()) target.webContents.send(IPC.command, command);
  };
  const toWidget = (command: DesktopCommand) => send(win, command);
  const toAll = (command: DesktopCommand) => {
    send(win, command);
    send(settingsWin, command);
  };
  const remember = () => {
    const [x, y] = win.getPosition();
    Object.assign(state, { x, y });
    saveState(state);
  };

  // --- Push-to-talk ---

  onPushToTalk({
    down: () => toWidget({ type: "ptt", down: true }),
    up: () => toWidget({ type: "ptt", down: false }),
  });
  let ptt: PushToTalk | null = setPushToTalk(state.hotkey);
  if (!ptt) console.warn(`Push-to-talk key ${state.hotkey} is taken by another program`);

  // --- Options ---

  const status = (): WidgetStatus => {
    const { x: _x, y: _y, ...options } = state;
    return { ...options, hotkeyLabel: ptt?.label ?? null, hotkeyMode: ptt?.mode ?? null };
  };

  /** Resizes the widget around its bottom centre (where the avatar stands);
   *  the page scales itself to the window width. */
  const resize = (scale: number) => {
    const { x, y, width, height } = win.getBounds();
    const size = scaledSize(scale);
    win.setBounds({ x: Math.round(x + (width - size.width) / 2), y: y + height - size.height, ...size });
  };

  const applyOptions = (patch: Partial<WidgetOptions>) => {
    const next = sanitize(patch);
    if (next.scale !== undefined && next.scale !== state.scale) resize(next.scale);
    if (next.alwaysOnTop !== undefined) win.setAlwaysOnTop(next.alwaysOnTop);
    if (next.hotkey !== undefined && next.hotkey !== state.hotkey) {
      const chosen = setPushToTalk(next.hotkey);
      if (chosen) ptt = chosen;
      else {
        delete next.hotkey; // taken or invalid: keep the old key
        ptt = setPushToTalk(state.hotkey);
      }
    }
    Object.assign(state, next);
    remember();
    toAll({ type: "options", options: status() });
    updateTray();
    return status();
  };

  ipcMain.handle(IPC.getOptions, () => status());
  ipcMain.handle(IPC.setOptions, (_event, patch: Partial<WidgetOptions>) => applyOptions(patch ?? {}));
  ipcMain.on(IPC.scaleBy, (_event, direction: 1 | -1) =>
    applyOptions({ scale: state.scale + Math.sign(direction) * SCALE_STEP }),
  );

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

  // --- Conversation history (kept by the widget, shown in the settings window) ---

  let history: HistoryEntry[] = [];
  ipcMain.on(IPC.reportHistory, (_event, entries: HistoryEntry[]) => {
    history = Array.isArray(entries) ? entries : [];
    send(settingsWin, { type: "history", entries: history });
  });
  ipcMain.handle(IPC.getHistory, () => history);

  const WIDGET_COMMANDS = new Set<WidgetCommand["type"]>(["newConversation", "stop", "say"]);
  ipcMain.on(IPC.sendToWidget, (_event, command: WidgetCommand) => {
    if (WIDGET_COMMANDS.has(command?.type)) toWidget(command);
  });

  // --- Settings window ---

  const openSettings = () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      if (settingsWin.isMinimized()) settingsWin.restore();
      settingsWin.focus();
      return;
    }
    settingsWin = new BrowserWindow({
      width: 760,
      height: 760,
      minWidth: 520,
      minHeight: 400,
      title: "Avatar – asetukset",
      icon: ICON,
      autoHideMenuBar: true,
      backgroundColor: "#12141a",
      show: false,
      webPreferences,
    });
    devShortcuts(settingsWin);
    settingsWin.once("ready-to-show", () => settingsWin?.show());
    settingsWin.on("closed", () => (settingsWin = null));
    loadWhenReady(settingsWin, "settings.html");
  };
  ipcMain.on(IPC.openSettings, openSettings);

  // --- Menus (right-click on the avatar and the tray icon) ---

  let page: MenuState = { lang: "fi" };
  ipcMain.on(IPC.reportState, (_event, next: MenuState) => {
    page = next;
  });

  const toggleVisible = () => {
    if (win.isVisible()) win.hide();
    else win.showInactive();
  };

  const buildMenu = (fromTray: boolean) => {
    const items: MenuItemConstructorOptions[] = [
      { label: "Keskeytä", click: () => toWidget({ type: "stop" }) },
      { label: "Uusi keskustelu", click: () => toWidget({ type: "newConversation" }) },
      { type: "separator" },
      {
        label: "Jatkuva kuuntelu",
        type: "checkbox",
        checked: state.listenMode === "always",
        enabled: !state.muted,
        click: (item) => applyOptions({ listenMode: item.checked ? "always" : "ptt" }),
      },
      {
        label: "Mykistä mikrofoni",
        type: "checkbox",
        checked: state.muted,
        click: (item) => applyOptions({ muted: item.checked }),
      },
      ptt
        ? { label: `Puhu: pidä ${ptt.label} pohjassa`, enabled: false }
        : { label: "Pikanäppäin on varattu – vaihda asetuksista", enabled: false },
      { type: "separator" },
      {
        label: "Kieli",
        submenu: [
          { label: "Suomi", type: "radio", checked: page.lang === "fi", click: () => toAll({ type: "lang", lang: "fi" }) },
          { label: "English", type: "radio", checked: page.lang === "en", click: () => toAll({ type: "lang", lang: "en" }) },
        ],
      },
      {
        label: "Koko",
        submenu: SCALE_PRESETS.map((preset) => ({
          label: `${Math.round(preset * 100)} %`,
          type: "radio" as const,
          checked: Math.abs(state.scale - preset) < 0.001,
          click: () => applyOptions({ scale: preset }),
        })),
      },
      {
        label: "Aina päällimmäisenä",
        type: "checkbox",
        checked: state.alwaysOnTop,
        click: (item) => applyOptions({ alwaysOnTop: item.checked }),
      },
      { type: "separator" },
      { label: "Asetukset…", click: openSettings },
      { label: "Kehittäjätyökalut", click: () => win.webContents.openDevTools({ mode: "detach" }) },
      { type: "separator" },
      { label: "Lopeta", click: () => app.quit() },
    ];
    if (fromTray) items.unshift({ label: win.isVisible() ? "Piilota avatar" : "Näytä avatar", click: toggleVisible }, { type: "separator" });
    return Menu.buildFromTemplate(items);
  };

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
    stopPushToTalk();
    tray.destroy();
  });
}

// Two copies would fight over the hotkey and the microphone: show the first one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => BrowserWindow.getAllWindows()[0]?.showInactive());
  app.whenReady().then(() => {
    // The pages are our own local app: allow the microphone without a prompt.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media"));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
    if (MODE === "window") createFullWindow();
    else createWidget();
  });
}

app.on("window-all-closed", () => app.quit());
