import assert from "node:assert/strict";
import { test } from "node:test";
import { SentenceSplitter, findSentenceEnd } from "./sentences.js";

/** Streams `text` in small pieces, like token deltas, and collects all chunks. */
function split(text: string, pieceLength = 3): string[] {
  const splitter = new SentenceSplitter();
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += pieceLength) chunks.push(...splitter.push(text.slice(i, i + pieceLength)));
  return [...chunks, ...splitter.flush()];
}

test("splits sentences on . ! ? followed by a capital", () => {
  assert.deepEqual(split("Moi! Mitä kuuluu? Minulla menee hyvin. Entä sinulla?"), [
    "Moi!",
    "Mitä kuuluu?",
    "Minulla menee hyvin.",
    "Entä sinulla?",
  ]);
});

test("waits for the next word before deciding", () => {
  assert.equal(findSentenceEnd("Moi."), null);
  assert.equal(findSentenceEnd("Moi. "), null);
  assert.equal(findSentenceEnd("Moi. M"), 4);
});

test("Finnish abbreviations, initials and numbers do not end a sentence", () => {
  assert.deepEqual(split("Syö esim. Omenoita tai mm. Päärynöitä. Klo 14.30 tavataan."), [
    "Syö esim. Omenoita tai mm. Päärynöitä.",
    "Klo 14.30 tavataan.",
  ]);
  assert.deepEqual(split("Kirjan kirjoitti J. K. Rowling. Se on hyvä."), ["Kirjan kirjoitti J. K. Rowling.", "Se on hyvä."]);
  assert.deepEqual(split("Tänään on 3.10. ja huomenna 4.10. Hienoa!"), ["Tänään on 3.10. ja huomenna 4.10.", "Hienoa!"]);
});

test("a sentence may end with a number", () => {
  assert.deepEqual(split("Se tapahtui vuonna 2026. Sitten kaikki muuttui."), [
    "Se tapahtui vuonna 2026.",
    "Sitten kaikki muuttui.",
  ]);
});

test("ordinals before a lowercase word stay together", () => {
  assert.deepEqual(split("Syntymäpäiväni on 3. lokakuuta. Tule juhliin!"), [
    "Syntymäpäiväni on 3. lokakuuta.",
    "Tule juhliin!",
  ]);
});

test("English abbreviations", () => {
  assert.deepEqual(split("Ask Dr. Smith, e.g. Tomorrow. Thanks!"), ["Ask Dr. Smith, e.g. Tomorrow.", "Thanks!"]);
});

test("quotes, ellipses and lowercase continuations", () => {
  assert.deepEqual(split('Hän sanoi: "Moi!" ja lähti. Odota... Mitä?'), ['Hän sanoi: "Moi!" ja lähti.', "Odota...", "Mitä?"]);
  assert.deepEqual(split("Hmm… Ehkä."), ["Hmm…", "Ehkä."]);
});

test("newlines end a chunk", () => {
  assert.deepEqual(split("Ensimmäinen rivi\nToinen rivi"), ["Ensimmäinen rivi", "Toinen rivi"]);
});

test("long sentences are cut at a comma; the first one earlier", () => {
  const first =
    "Tämä on aika pitkä ensimmäinen lause, jossa on monta osaa, ja se jatkuu vielä pitkään ennen kuin se loppuu.";
  const chunks = split(first);
  assert.ok(chunks.length >= 2, "first long sentence should be cut");
  assert.ok(chunks[0]!.endsWith(","));
  assert.equal(chunks.join(" "), first);

  const later = `Lyhyt alku. ${"Toinen lause on keskipitkä, mutta silti alle rajan ja jatkuu"} vielä.`;
  assert.deepEqual(split(later), ["Lyhyt alku.", "Toinen lause on keskipitkä, mutta silti alle rajan ja jatkuu vielä."]);
});

test("text without any punctuation is cut at a space eventually", () => {
  const words = Array.from({ length: 80 }, (_, i) => `sana${i}`).join(" ");
  const chunks = split(words, 7);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(" "), words);
});

test("when the stream pauses, a finished-looking sentence goes out without the next word", () => {
  const take = (text: string) => {
    const splitter = new SentenceSplitter();
    splitter.push(text);
    return splitter.flushIfComplete();
  };
  assert.deepEqual(take("Ha, sneaky!"), ["Ha, sneaky!"]);
  assert.deepEqual(take("Mitä kuuluu? "), ["Mitä kuuluu?"]);
  assert.deepEqual(take("Hyvä on."), ["Hyvä on."]);
  assert.deepEqual(take('Hän sanoi "moi."'), ['Hän sanoi "moi."']);
  assert.deepEqual(take("Odota..."), ["Odota..."]);
  // Not yet: could continue as an abbreviation, initial, ordinal or mid-sentence.
  assert.deepEqual(take("Syö esim."), []);
  assert.deepEqual(take("Kirjan kirjoitti J."), []);
  assert.deepEqual(take("Syntymäpäiväni on 3."), []);
  assert.deepEqual(take("Ja sitten"), []);
});

test("an emotion mark starts a new sentence and stays with it", () => {
  const happy = "";
  const surprised = "";
  assert.deepEqual(split(`${happy}Hauska kuulla. ${surprised}ihanko totta?`), [
    `${happy}Hauska kuulla.`,
    `${surprised}ihanko totta?`,
  ]);

  // A mark right after a sentence settles the boundary at once.
  const splitter = new SentenceSplitter();
  assert.deepEqual(splitter.push(`Hetki, katson. ${surprised}`), ["Hetki, katson."]);
  splitter.push("Huomenna sataa.");
  assert.deepEqual(splitter.flush(), [`${surprised}Huomenna sataa.`]);

  // During a pause the finished sentence goes out; a mark glued to it waits for its sentence.
  const paused = new SentenceSplitter();
  assert.deepEqual(paused.push(`Hetki, katson.${surprised}`), []);
  assert.deepEqual(paused.flushIfComplete(), ["Hetki, katson."]);
  assert.deepEqual(paused.flush(), [surprised]);
});

test("flush returns the unfinished tail", () => {
  const splitter = new SentenceSplitter();
  assert.deepEqual(splitter.push("Moi."), []);
  assert.deepEqual(splitter.push(" Mitä"), ["Moi."]);
  assert.deepEqual(splitter.push(" kuuluu"), []);
  assert.deepEqual(splitter.flush(), ["Mitä kuuluu"]);
  assert.deepEqual(splitter.flush(), []);
});
