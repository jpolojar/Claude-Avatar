import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "../shared/protocol.js";
import { config } from "./config.js";
import { stripMarkers } from "./markers.js";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

const PERSONA = readFileSync(new URL("./persona.md", import.meta.url), "utf8").trim();

const LANGUAGE_LINE: Record<Lang, string> = {
  fi: "Keskustelun kieli on aluksi suomi.",
  en: "The conversation language is English to begin with: reply in English even though these instructions are written in Finnish.",
};

const LANGUAGE_SWITCH: Record<Lang, string> = {
  fi: "Käyttäjä vaihtoi keskustelun kieleksi suomen. Vastaa tästä eteenpäin suomeksi.",
  en: "The user switched the conversation language to English. Reply in English from now on.",
};

const WEB_SEARCH = `Verkkohaku: voit hakea verkosta ajankohtaista tietoa, kuten säätä, uutisia, aukioloaikoja, tapahtumia, urheilutuloksia tai hintoja. Hae vain, kun vastaus todella vaatii tuoretta tietoa. Tavallinen juttelu ja yleistieto eivät vaadi hakua. Yksi haku riittää yleensä. Sovellus kertoo käyttäjälle itse, että haet tietoa, joten älä aloita vastausta sanomalla, että katsoit tai hait jotain. Kerro tulos yhdellä tai kahdella lyhyellä lauseella omin sanoin: vain olennainen, luvut pyöristettyinä ja ilman lähteitä tai osoitteita, ellei käyttäjä kysy niitä. Jos tulokset ovat epävarmoja, sano se lyhyesti. Jos tarvitset paikkakunnan eikä käyttäjä ole maininnut sitä, oleta Suomi ja kysy tarvittaessa tarkennusta.`;

const INTERRUPTED_MARK = "[interrupted by the user]";
const INTERRUPTED_BEFORE_SPEAKING = "[the user interrupted before I said anything]";

export function buildSystemPrompt(lang: Lang, now = new Date(), memory: string | null = null): string {
  const date = now.toLocaleDateString("fi-FI", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const remembered = memory
    ? `\n\nMuistiinpanosi aiemmista keskusteluista tämän käyttäjän kanssa. Hyödynnä niitä luontevasti, kun ne liittyvät aiheeseen, mutta älä luettele niitä:\n${memory}`
    : "";
  const search = config.webSearch !== "off" ? `\n\n${WEB_SEARCH}` : "";
  return `${PERSONA}${search}\n\n${LANGUAGE_LINE[lang]}\n\nTänään on ${date}.${remembered}`;
}

/**
 * One conversation. The system prompt is frozen at creation and the history is
 * append-only text (no thinking blocks are replayed), which keeps the prompt
 * cache warm and can never trip the API's history-editing check.
 */
export class Session {
  readonly system: string;
  readonly messages: MessageParam[] = [];
  private lang: Lang;
  /** messages.length when the memory note last covered this session. */
  private summarizedUpTo = 0;

  constructor(
    readonly id: string,
    lang: Lang,
    now = new Date(),
    memory: string | null = null,
  ) {
    this.lang = lang;
    this.system = buildSystemPrompt(lang, now, memory);
  }

  /** The turns not yet folded into the memory note, as a plain transcript ("" if none). */
  transcriptSinceSummary(): string {
    const turns = this.messages.slice(this.summarizedUpTo).filter((m) => m.role !== "system");
    if (!turns.some((m) => m.role === "assistant")) return "";
    return turns
      .map((m) => {
        const text = typeof m.content === "string" ? m.content : "";
        return `${m.role === "user" ? "Käyttäjä" : "Avatar"}: ${stripMarkers(text)}`;
      })
      .join("\n");
  }

  markSummarized(): void {
    this.summarizedUpTo = this.messages.length;
  }

  get language(): Lang {
    return this.lang;
  }

  /**
   * Appends the user's turn, plus a mid-conversation system message when the
   * language changed. Returns a function that undoes both if the request fails.
   */
  beginTurn(text: string, lang: Lang): () => void {
    const start = this.messages.length;
    const previousLang = this.lang;
    this.messages.push({ role: "user", content: text });
    if (lang !== this.lang) {
      this.messages.push({ role: "system", content: LANGUAGE_SWITCH[lang] });
      this.lang = lang;
    }
    return () => {
      this.messages.length = start;
      this.lang = previousLang;
    };
  }

  /** Claude switched the language itself (with a [[xx]] marker); no system note needed. */
  adoptLanguage(lang: Lang): void {
    this.lang = lang;
  }

  /**
   * The user cut off the last reply while it was being spoken: keep only what
   * they heard. Editing this turn is safe because the history is plain text
   * (no thinking blocks are replayed); it only re-caches from this turn on.
   */
  markInterrupted(spokenText: string): void {
    const last = this.messages.at(-1);
    if (last?.role !== "assistant") return;
    const spoken = spokenText.trim();
    // Cut mid-sentence gets an ellipsis; cut between sentences doesn't need one.
    const cut = /[.!?…]$/.test(spoken) ? spoken : `${spoken}…`;
    last.content = spoken ? `${cut} ${INTERRUPTED_MARK}` : INTERRUPTED_BEFORE_SPEAKING;
  }

  /** Records what the avatar actually said; interrupted replies get a marker. */
  endTurn(replyText: string, interrupted: boolean): void {
    const text = replyText.trim();
    this.messages.push({
      role: "assistant",
      content: interrupted ? `${text}… ${INTERRUPTED_MARK}`.trim() : text,
    });
  }
}

const sessions = new Map<string, Session>();
const MAX_SESSIONS = 20;

export function findSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function getSession(id: string, lang: Lang, memory: string | null = null): Session {
  let session = sessions.get(id);
  if (!session) {
    session = new Session(id, lang, new Date(), memory);
    sessions.set(id, session);
    // Single-user app: just drop the oldest conversations.
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }
  return session;
}
