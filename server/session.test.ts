import assert from "node:assert/strict";
import { test } from "node:test";
import { Session, buildSystemPrompt } from "./session.js";

test("system prompt carries persona, language and date", () => {
  const fi = buildSystemPrompt("fi", new Date(2026, 9, 3));
  assert.match(fi, /keskustelukaveri/);
  assert.match(fi, /kieli on aluksi suomi/);
  assert.match(fi, /\[\[en\]\]/);
  assert.match(fi, /2026/);
  assert.match(buildSystemPrompt("en"), /reply in English/);
});

test("memory note goes into the system prompt", () => {
  assert.doesNotMatch(buildSystemPrompt("fi"), /Muistiinpanosi/);
  assert.match(buildSystemPrompt("fi", new Date(), "- Nimi: Jussi"), /Muistiinpanosi[^]*- Nimi: Jussi/);
});

test("transcript since the last summary", () => {
  const s = new Session("g", "fi");
  assert.equal(s.transcriptSinceSummary(), "");
  s.beginTurn("Can you speak English?", "fi");
  s.endTurn("[[en]] Sure!", false);
  assert.equal(s.transcriptSinceSummary(), "Käyttäjä: Can you speak English?\nAvatar: Sure!");
  s.markSummarized();
  assert.equal(s.transcriptSinceSummary(), "");
  s.beginTurn("Thanks", "en");
  assert.equal(s.transcriptSinceSummary(), "", "no reply yet, nothing to remember");
});

test("turns are appended in order", () => {
  const s = new Session("a", "fi");
  s.beginTurn("Moi", "fi");
  s.endTurn("Moi vaan!", false);
  assert.deepEqual(
    s.messages.map((m) => m.role),
    ["user", "assistant"],
  );
});

test("language switch appends a system message after the user turn", () => {
  const s = new Session("b", "fi");
  s.beginTurn("Moi", "fi");
  s.endTurn("Hei!", false);
  s.beginTurn("Let's speak English", "en");
  assert.deepEqual(
    s.messages.map((m) => m.role),
    ["user", "assistant", "user", "system"],
  );
  assert.equal(s.language, "en");
  // The frozen system prompt does not change mid-conversation.
  assert.match(s.system, /kieli on aluksi suomi/);
});

test("a language Claude switched to itself adds no system note", () => {
  const s = new Session("e", "fi");
  s.beginTurn("Can you speak English?", "fi");
  s.adoptLanguage("en");
  s.endTurn("[[en]] Sure!", false);
  s.beginTurn("Great", "en");
  assert.deepEqual(
    s.messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
});

test("rollback undoes the turn and the language switch", () => {
  const s = new Session("c", "fi");
  const rollback = s.beginTurn("Hello", "en");
  rollback();
  assert.equal(s.messages.length, 0);
  assert.equal(s.language, "fi");
});

test("an interruption trims the last reply to what was heard", () => {
  const s = new Session("f", "fi");
  s.beginTurn("Kerro tarina", "fi");
  s.endTurn("Olipa kerran prinsessa. Hän asui linnassa.", false);
  s.markInterrupted("Olipa kerran prinsessa.");
  assert.equal(s.messages[1]?.content, "Olipa kerran prinsessa. [interrupted by the user]");
  s.markInterrupted("Olipa kerran");
  assert.equal(s.messages[1]?.content, "Olipa kerran… [interrupted by the user]");
  s.markInterrupted("");
  assert.equal(s.messages[1]?.content, "[the user interrupted before I said anything]");
  // Only the latest reply can be interrupted.
  s.beginTurn("Jatka", "fi");
  s.markInterrupted("x");
  assert.equal(s.messages[2]?.content, "Jatka");
});

test("interrupted replies are marked", () => {
  const s = new Session("d", "fi");
  s.beginTurn("Kerro tarina", "fi");
  s.endTurn("Olipa kerran ", true);
  assert.equal(s.messages[1]?.content, "Olipa kerran… [interrupted by the user]");
});
