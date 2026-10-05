// What the installed app runs by itself: the API server (in this process) and
// local Whisper, with the API key from the settings window. In development
// (npm run widget) the npm scripts run them and this only points at Vite.
import { app } from "electron";
import type { ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { ApiKeyResult, AppSetup } from "../shared/desktop.js";
import { loadApiKey, saveApiKey } from "./secrets.js";
import { findWhisper, startWhisper } from "./whisper.js";

/** Fixed, so the pages keep their origin (and localStorage settings) between runs. */
const SERVER_PORT = Number(process.env.AVATAR_PORT || 47821);
const WHISPER_PORT = Number(process.env.AVATAR_WHISPER_PORT || 8178);
/** desktop/dist (inside app.asar when installed) → the app root. */
const APP_ROOT = join(__dirname, "..", "..");

interface SavedSetup {
  whisperDir?: string;
}

export class Runtime {
  /** The app runs its own server (installed, or npm run widget:internal). */
  readonly managed = app.isPackaged || process.argv.includes("--internal-server");
  url = process.env.AVATAR_WIDGET_URL || "http://localhost:5173";

  private whisper: AppSetup["whisper"] = "missing";
  private whisperProcess: ChildProcess | null = null;
  private saved: SavedSetup = {};
  private listeners: ((setup: AppSetup) => void)[] = [];

  private get savedPath(): string {
    return join(app.getPath("userData"), "app-setup.json");
  }

  onChange(listener: (setup: AppSetup) => void): void {
    this.listeners.push(listener);
  }

  private changed(): void {
    const setup = this.setup();
    for (const listener of this.listeners) listener(setup);
  }

  setup(): AppSetup {
    return {
      managed: this.managed,
      hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
      whisperDir: this.whisperDir(),
      whisper: this.whisper,
      autostart: app.isPackaged ? app.getLoginItemSettings().openAtLogin : null,
    };
  }

  /** Starts the server when managed (and Whisper in the background); sets `url`. */
  async start(): Promise<void> {
    if (!this.managed) return;
    try {
      this.saved = JSON.parse(readFileSync(this.savedPath, "utf8")) as SavedSetup;
    } catch {
      // first run
    }
    // The server reads these when its modules load (below).
    process.env.AVATAR_DATA_DIR ||= join(app.getPath("userData"), "data");
    process.env.AVATAR_PERSONA_FILE ||= join(__dirname, "persona.md");
    process.env.AVATAR_WHISPER_PORT = String(WHISPER_PORT);
    process.env.ANTHROPIC_API_KEY ||= loadApiKey() ?? "";

    const { startServer } = await import("../server/app.js");
    const staticDir = join(APP_ROOT, "dist", "web");
    let server;
    try {
      server = await startServer({ port: SERVER_PORT, staticDir });
    } catch (err) {
      // Taken by something else: any free port (the pages' settings start over).
      console.warn(`Port ${SERVER_PORT} unavailable, using a free one`, err);
      server = await startServer({ port: 0, staticDir });
    }
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    void this.startWhisper(); // the widget waits for it on its own
  }

  private whisperDir(): string | null {
    return process.env.AVATAR_WHISPER_DIR || this.saved.whisperDir || this.defaultWhisperDir();
  }

  /** A development checkout keeps whisper.cpp in local/whisper. */
  private defaultWhisperDir(): string | null {
    const dir = join(APP_ROOT, "local", "whisper");
    return app.isPackaged || !findWhisper(dir) ? null : dir;
  }

  private async whisperAnswers(): Promise<boolean> {
    try {
      return (await fetch(`http://127.0.0.1:${WHISPER_PORT}`, { signal: AbortSignal.timeout(800) })).ok;
    } catch {
      return false;
    }
  }

  private async startWhisper(): Promise<void> {
    this.stopWhisper();
    if (await this.whisperAnswers()) {
      this.whisper = "external"; // e.g. npm run dev is running
      this.changed();
      return;
    }
    const dir = this.whisperDir();
    const install = dir ? findWhisper(dir) : null;
    if (!install) {
      this.whisper = "missing";
      this.changed();
      return;
    }
    this.whisper = "starting";
    this.changed();
    const child = startWhisper(install, WHISPER_PORT, (code) => {
      if (this.whisperProcess !== child) return;
      console.warn(`[whisper] exited (${code})`);
      this.whisperProcess = null;
      this.whisper = "failed";
      this.changed();
    });
    this.whisperProcess = child;
    // Loading the model takes a few seconds.
    for (let i = 0; i < 60 && this.whisperProcess === child; i++) {
      if (await this.whisperAnswers()) {
        this.whisper = "running";
        this.changed();
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  private stopWhisper(): void {
    const child = this.whisperProcess;
    this.whisperProcess = null;
    child?.kill();
  }

  async setWhisperDir(dir: string): Promise<AppSetup> {
    this.saved.whisperDir = dir;
    this.save();
    await this.startWhisper();
    return this.setup();
  }

  async setApiKey(key: string): Promise<ApiKeyResult> {
    const trimmed = key.trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(trimmed)) return { ok: false, reason: "invalid" };
    const { checkApiKey, resetClient } = await import("../server/claude.js");
    try {
      if (!(await checkApiKey(trimmed))) return { ok: false, reason: "rejected" };
    } catch {
      return { ok: false, reason: "network" };
    }
    try {
      saveApiKey(trimmed);
    } catch {
      return { ok: false, reason: "storage" };
    }
    process.env.ANTHROPIC_API_KEY = trimmed;
    resetClient();
    this.changed();
    return { ok: true };
  }

  setAutostart(on: boolean): AppSetup {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on });
    this.changed();
    return this.setup();
  }

  stop(): void {
    this.stopWhisper();
  }

  private save(): void {
    try {
      writeFileSync(this.savedPath, JSON.stringify(this.saved));
    } catch (err) {
      console.warn("Could not save the app setup", err);
    }
  }
}
