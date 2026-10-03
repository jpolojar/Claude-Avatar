import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTranscript } from "./stt.js";

test("keeps normal speech, trimmed", () => {
  assert.equal(cleanTranscript("  Moi, mitä kuuluu?\n"), "Moi, mitä kuuluu?");
});

test("drops Whisper's silence hallucinations", () => {
  assert.equal(cleanTranscript(" Kiitos katsomisesta!"), "");
  assert.equal(cleanTranscript("[BLANK_AUDIO]"), "");
  assert.equal(cleanTranscript("(musiikkia)"), "");
  assert.equal(cleanTranscript("Thank you for watching."), "");
});
