import assert from "node:assert/strict";
import { test } from "node:test";
import { queryOf } from "./claude.js";

test("search query from streamed JSON or a complete input object", () => {
  assert.equal(queryOf('{"query": "sää Lohja huomenna"}'), "sää Lohja huomenna");
  assert.equal(queryOf({ query: "uutiset tänään" }), "uutiset tänään");
  assert.equal(queryOf({ url: "https://yle.fi/uutiset" }), "https://yle.fi/uutiset");
});

test("no query when the input is empty or unusable", () => {
  assert.equal(queryOf(""), null);
  assert.equal(queryOf("{}"), null);
  assert.equal(queryOf({}), null);
  assert.equal(queryOf({ query: "  " }), null);
  assert.equal(queryOf(null), null);
});
