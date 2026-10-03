// Long-term memory: after a conversation, Claude folds what is worth
// remembering into a short note in data/memory.json, and the note is given
// to the avatar at the start of the next conversation.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryResponse } from "../shared/protocol.js";
import { getClient } from "./claude.js";
import { config } from "./config.js";
import type { Session } from "./session.js";

const FILE = join(config.dataDir, "memory.json");
const MAX_WORDS = 200;

interface MemoryFile {
  summary: string;
  updatedAt: string;
}

let cached: MemoryFile | null = null;
let loaded = false;

export async function loadMemory(): Promise<MemoryFile | null> {
  if (!loaded) {
    try {
      cached = JSON.parse(await readFile(FILE, "utf8")) as MemoryFile;
    } catch {
      cached = null;
    }
    loaded = true;
  }
  return cached;
}

/** The current note, for new sessions (call loadMemory() once at startup). */
export function currentMemory(): string | null {
  return cached?.summary || null;
}

export async function getMemory(): Promise<MemoryResponse> {
  const memory = await loadMemory();
  return { summary: memory?.summary ?? null, updatedAt: memory?.updatedAt ?? null };
}

export async function clearMemory(): Promise<void> {
  cached = null;
  loaded = true;
  await rm(FILE, { force: true });
}

const INSTRUCTIONS = `Päivitä muistiinpanot, joiden avulla puhuva avatar muistaa käyttäjän seuraavissa keskusteluissa.

Säilytä olennainen aiemmista muistiinpanoista ja lisää uudesta keskustelusta:
- käyttäjän nimi ja perustiedot, jos ne mainittiin
- mieltymykset, kiinnostuksen kohteet ja tärkeät elämäntilanteet
- asiat, joihin luvattiin palata, ja keskeneräiset puheenaiheet

Älä keksi mitään, älä kirjaa ohimeneviä pikkuasioita äläkä toista samaa asiaa. Kirjoita suomeksi lyhyinä viivoilla alkavina riveinä, yhteensä enintään ${MAX_WORDS} sanaa. Vastaa pelkillä muistiinpanoilla. Jos mitään muistettavaa ei ole, palauta aiemmat muistiinpanot sellaisinaan.`;

/** Folds the session's new turns into the memory note. Returns false if there was nothing new. */
export async function summarizeSession(session: Session): Promise<boolean> {
  const transcript = session.transcriptSinceSummary();
  if (!transcript) return false;
  const previous = (await loadMemory())?.summary ?? "";

  const response = await getClient().beta.messages.create({
    model: config.model,
    max_tokens: 2048,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: INSTRUCTIONS,
    messages: [
      {
        role: "user",
        content: `Aiemmat muistiinpanot:\n${previous || "(ei vielä muistiinpanoja)"}\n\nUusi keskustelu:\n${transcript}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("memory summary was refused");
  const summary = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  if (!summary) return false;

  cached = { summary, updatedAt: new Date().toISOString() };
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(FILE, JSON.stringify(cached, null, 2), "utf8");
  session.markSummarized();
  return true;
}
