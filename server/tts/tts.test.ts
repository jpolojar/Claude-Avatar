import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanForSpeech, isKnownVoice } from "./index.js";

test("cleanForSpeech removes markdown, links and emoji", () => {
  assert.equal(cleanForSpeech("**Moi!** 😊 Katso https://example.com/x tästä."), "Moi! Katso tästä.");
  assert.equal(cleanForSpeech("# Otsikko\n- kohta `koodi`"), "Otsikko - kohta koodi");
});

test("cleanForSpeech keeps Finnish letters and punctuation", () => {
  assert.equal(cleanForSpeech("Äiti, öljy ja Åland: 3,5 €?"), "Äiti, öljy ja Åland: 3,5 €?");
});

test("only curated voices are accepted", () => {
  assert.ok(isKnownVoice("edge", "fi-FI-NooraNeural"));
  assert.ok(!isKnownVoice("edge", 'fi-FI-NooraNeural"><evil'));
  assert.ok(isKnownVoice("piper", "fi_FI-harri-medium"));
  assert.ok(!isKnownVoice("piper", "fi-FI-NooraNeural"));
});
