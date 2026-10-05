// Local speech recognition for the installed app: finds whisper.cpp in the
// folder chosen in the settings window and runs its server (development uses
// scripts/whisper.mjs instead).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface WhisperInstall {
  bin: string;
  model: string;
}

const SERVER_PATHS = [
  "whisper-server.exe",
  join("bin", "Release", "whisper-server.exe"),
  join("Release", "whisper-server.exe"),
  join("build", "bin", "Release", "whisper-server.exe"),
];

/** whisper-server.exe and a ggml model in `dir` (the layout of the release zip works as is). */
export function findWhisper(dir: string): WhisperInstall | null {
  try {
    const bin = SERVER_PATHS.map((p) => join(dir, p)).find((p) => existsSync(p));
    if (!bin) return null;
    const models = readdirSync(dir)
      .filter((f) => /^ggml-.+\.bin$/i.test(f))
      .map((f) => join(dir, f));
    if (models.length === 0) return null;
    // Prefer the turbo model (fast and good in Finnish), else the biggest.
    const model =
      models.find((m) => /turbo/i.test(m)) ?? models.sort((a, b) => statSync(b).size - statSync(a).size)[0]!;
    return { bin, model };
  } catch {
    return null;
  }
}

/** Starts whisper-server on 127.0.0.1:port; `onExit` reports a crash or a taken port. */
export function startWhisper(install: WhisperInstall, port: number, onExit: (code: number | null) => void): ChildProcess {
  const child = spawn(
    install.bin,
    ["-m", install.model, "--host", "127.0.0.1", "--port", String(port), "-nt", "-t", "4", "-l", "auto"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  // whisper.cpp is chatty; only pass on what matters.
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream! }).on("line", (line) => {
      if (/error|fail|listening/i.test(line)) console.log(`[whisper] ${line}`);
    });
  }
  child.on("exit", (code) => onExit(code));
  child.on("error", (err) => {
    console.warn(`[whisper] failed to start: ${err.message}`);
    onExit(-1);
  });
  return child;
}
