// Exposes the desktop bridge to the widget page (sandboxed, context-isolated).
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type DesktopBridge, type DesktopCommand, type MicConfig } from "../shared/desktop.js";

const bridge: DesktopBridge = {
  setInteractive: (interactive) => ipcRenderer.send(IPC.setInteractive, interactive),
  startDrag: () => ipcRenderer.send(IPC.startDrag),
  endDrag: () => ipcRenderer.send(IPC.endDrag),
  showMenu: () => ipcRenderer.send(IPC.showMenu),
  reportState: (state) => ipcRenderer.send(IPC.reportState, state),
  getMicConfig: () => ipcRenderer.invoke(IPC.getMicConfig) as Promise<MicConfig>,
  scaleBy: (direction) => ipcRenderer.send(IPC.scaleBy, direction),
  onCommand: (listener) => {
    ipcRenderer.on(IPC.command, (_event, command: DesktopCommand) => listener(command));
  },
};

contextBridge.exposeInMainWorld("avatarDesktop", bridge);
