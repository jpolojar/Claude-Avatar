// Starts the local whisper.cpp server for always-on listening, if it is
// installed (see README). Exits quietly otherwise so `npm run dev` still works.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

const bin = process.env.AVATAR_WHISPER_BIN || "local/whisper/bin/Release/whisper-server.exe";
const model = process.env.AVATAR_WHISPER_MODEL || "local/whisper/ggml-large-v3-turbo-q5_0.bin";
const port = process.env.AVATAR_WHISPER_PORT || "8178";

if (!existsSync(bin) || !existsSync(model)) {
  console.log("Whisper is not installed (see README); always-on listening is unavailable.");
  process.exit(0);
}

const child = spawn(bin, ["-m", model, "--host", "127.0.0.1", "--port", port, "-nt", "-t", "4", "-l", "auto"], {
  stdio: ["ignore", "pipe", "pipe"],
});

// whisper.cpp is chatty; only pass on what matters.
for (const stream of [child.stdout, child.stderr]) {
  createInterface({ input: stream }).on("line", (line) => {
    if (/error|fail|listening|CUDA0 total size/i.test(line)) console.log(line);
  });
}

// A failing Whisper (e.g. the port is taken) must not take the rest of `npm run dev` down.
child.on("exit", (code) => {
  if (code) console.log(`Whisper stopped (exit code ${code}); always-on listening is unavailable.`);
  process.exit(0);
});
child.on("error", (err) => {
  console.log(`Whisper failed to start: ${err.message}`);
  process.exit(0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
