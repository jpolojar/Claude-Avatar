import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "../shared/protocol.js";

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

const INTERRUPTED_MARK = "[interrupted by the user]";

export function buildSystemPrompt(lang: Lang, now = new Date()): string {
  const date = now.toLocaleDateString("fi-FI", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${PERSONA}\n\n${LANGUAGE_LINE[lang]}\n\nTänään on ${date}.`;
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

  constructor(
    readonly id: string,
    lang: Lang,
    now = new Date(),
  ) {
    this.lang = lang;
    this.system = buildSystemPrompt(lang, now);
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

export function getSession(id: string, lang: Lang): Session {
  let session = sessions.get(id);
  if (!session) {
    session = new Session(id, lang);
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
