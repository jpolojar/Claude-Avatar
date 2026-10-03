import assert from "node:assert/strict";
import { test } from "node:test";
import { LanguageMarkerFilter } from "./language-marker.js";

function run(deltas: string[]) {
  const filter = new LanguageMarkerFilter();
  let text = "";
  let lang: string | undefined;
  for (const d of deltas) {
    const out = filter.push(d);
    text += out.text;
    lang ??= out.lang;
  }
  const end = filter.finish();
  text += end.text;
  lang ??= end.lang;
  return { text, lang };
}

test("marker split across deltas is stripped and reported", () => {
  assert.deepEqual(run(["[[", "en", "]] ", "Sure, ", "let's speak English."]), {
    text: "Sure, let's speak English.",
    lang: "en",
  });
});

test("marker in a single delta", () => {
  assert.deepEqual(run(["[[fi]] Selvä!"]), { text: "Selvä!", lang: "fi" });
});

test("text without a marker passes through unchanged", () => {
  assert.deepEqual(run(["Moi! ", "Mitä kuuluu?"]), { text: "Moi! Mitä kuuluu?", lang: undefined });
});

test("a reply that starts with a bracket is not swallowed", () => {
  assert.deepEqual(run(["[", "huom] ok"]), { text: "[huom] ok", lang: undefined });
});

test("a reply that is only the marker still switches language", () => {
  assert.deepEqual(run(["[[en]]"]), { text: "", lang: "en" });
});

test("text is not held back once it cannot be a marker", () => {
  const filter = new LanguageMarkerFilter();
  assert.deepEqual(filter.push("Moi"), { text: "Moi" });
});
