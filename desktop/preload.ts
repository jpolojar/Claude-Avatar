// Exposes the desktop bridge to the app's pages (sandboxed, context-isolated).
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type ApiKeyResult,
  type AppSetup,
  type DesktopBridge,
  type DesktopCommand,
  type HistoryEntry,
  type WidgetStatus,
} from "../shared/desktop.js";

const bridge: DesktopBridge = {
  setInteractive: (interactive) => ipcRenderer.send(IPC.setInteractive, interactive),
  startDrag: () => ipcRenderer.send(IPC.startDrag),
  endDrag: () => ipcRenderer.send(IPC.endDrag),
  showMenu: () => ipcRenderer.send(IPC.showMenu),
  reportState: (state) => ipcRenderer.send(IPC.reportState, state),
  reportHistory: (entries) => ipcRenderer.send(IPC.reportHistory, entries),
  scaleBy: (direction) => ipcRenderer.send(IPC.scaleBy, direction),
  getOptions: () => ipcRenderer.invoke(IPC.getOptions) as Promise<WidgetStatus>,
  openSettings: () => ipcRenderer.send(IPC.openSettings),
  onCommand: (listener) => {
    ipcRenderer.on(IPC.command, (_event, command: DesktopCommand) => listener(command));
  },
  setOptions: (patch) => ipcRenderer.invoke(IPC.setOptions, patch) as Promise<WidgetStatus>,
  getHistory: () => ipcRenderer.invoke(IPC.getHistory) as Promise<HistoryEntry[]>,
  sendToWidget: (command) => ipcRenderer.send(IPC.sendToWidget, command),
  getSetup: () => ipcRenderer.invoke(IPC.getSetup) as Promise<AppSetup>,
  setApiKey: (key) => ipcRenderer.invoke(IPC.setApiKey, key) as Promise<ApiKeyResult>,
  chooseWhisperDir: () => ipcRenderer.invoke(IPC.chooseWhisperDir) as Promise<AppSetup>,
  setAutostart: (on) => ipcRenderer.invoke(IPC.setAutostart, on) as Promise<AppSetup>,
};

contextBridge.exposeInMainWorld("avatarDesktop", bridge);
