import assert from "node:assert/strict";
import test from "node:test";

import { catalogRevision, stableJson } from "../src/catalog-revision.mjs";

test("catalog revision is stable across object key order", () => {
  assert.equal(catalogRevision({ b: 2, a: { d: 4, c: 3 } }), catalogRevision({ a: { c: 3, d: 4 }, b: 2 }));
});

test("catalog revision only receives a public projection", () => {
  const publicProjection = { tunnels: [{ id: "one", hasKeyPassphrase: true }] };
  const serialized = stableJson(publicProjection);
  assert.doesNotMatch(serialized, /passphraseRef|private-key-secret/);
  assert.match(catalogRevision(publicProjection), /^[a-f0-9]{24}$/);
});
