// The Claude API key of the installed app, encrypted with Windows DPAPI
// (Electron's safeStorage) in the user data folder. Development keeps using .env.
import { app, safeStorage } from "electron";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const keyPath = () => join(app.getPath("userData"), "api-key.bin");

export function loadApiKey(): string | null {
  try {
    if (!existsSync(keyPath()) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(readFileSync(keyPath())) || null;
  } catch (err) {
    console.warn("Could not read the stored API key", err);
    return null;
  }
}

export function saveApiKey(key: string | null): void {
  if (!key) {
    rmSync(keyPath(), { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Encryption is unavailable");
  writeFileSync(keyPath(), safeStorage.encryptString(key));
}
