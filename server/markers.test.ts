import assert from "node:assert/strict";
import { test } from "node:test";
import { MarkerFilter, emotionChar, stripMarkers, takeEmotion, type Piece } from "./markers.js";

function run(deltas: string[]): Piece[] {
  const filter = new MarkerFilter();
  const pieces = [...deltas.flatMap((d) => filter.push(d)), ...filter.finish()];
  // Merge adjacent text for easier comparison.
  return pieces.reduce<Piece[]>((out, p) => {
    const last = out.at(-1);
    if (typeof p === "string" && typeof last === "string") out[out.length - 1] = last + p;
    else out.push(p);
    return out;
  }, []);
}

const happy = { kind: "emotion", emotion: "happy" } as const;
const surprised = { kind: "emotion", emotion: "surprised" } as const;
const en = { kind: "lang", lang: "en" } as const;

test("language and emotion markers at the start, split across deltas", () => {
  assert.deepEqual(run(["[[", "en]] [[hap", "py]] ", "Sure, ", "let's speak English."]), [
    en,
    happy,
    "Sure, let's speak English.",
  ]);
});

test("emotion markers mid-reply keep their position", () => {
  assert.deepEqual(run(["[[happy]] Hauska kuulla. [[surprised]] Ihanko totta?"]), [
    happy,
    "Hauska kuulla. ",
    surprised,
    "Ihanko totta?",
  ]);
});

test("text without markers passes through unchanged", () => {
  assert.deepEqual(run(["Moi! ", "Mitä kuuluu?"]), ["Moi! Mitä kuuluu?"]);
});

test("brackets that are not markers are kept", () => {
  assert.deepEqual(run(["[", "huom] ok"]), ["[huom] ok"]);
  assert.deepEqual(run(["Katso [[wiki]] ja [[ tämä"]), ["Katso [[wiki]] ja [[ tämä"]);
});

test("a reply that is only a marker", () => {
  assert.deepEqual(run(["[[en]]"]), [en]);
});

test("text is not held back once it cannot be a marker", () => {
  assert.deepEqual(new MarkerFilter().push("Moi"), ["Moi"]);
});

test("stripMarkers removes known markers only", () => {
  assert.equal(stripMarkers("[[en]] [[happy]] Sure! [[sad]] Oh no. [[wiki]]"), "Sure! Oh no. [[wiki]]");
});

test("takeEmotion finds the marked mood of a sentence", () => {
  assert.deepEqual(takeEmotion(`${emotionChar("sad")}Voi ei, ikävä kuulla.`), {
    text: "Voi ei, ikävä kuulla.",
    emotion: "sad",
  });
  assert.deepEqual(takeEmotion("Ei merkintää."), { text: "Ei merkintää.", emotion: null });
  assert.deepEqual(takeEmotion(emotionChar("happy")), { text: "", emotion: "happy" });
});
