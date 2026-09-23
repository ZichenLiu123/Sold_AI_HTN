import assert from "node:assert/strict";
import test from "node:test";
import { scriptedCoreReady } from "../src/lib/marketplace/scripted-fill.ts";
import type { Listing } from "../src/lib/types.ts";

const listing = {
  title: "Owala FreeSip 32oz",
  price: 18,
  description: "Clean bottle.",
} as Listing;

test("scriptedCoreReady requires title price and description when present", () => {
  assert.equal(
    scriptedCoreReady({ title: true, price: true, description: true }, listing),
    true
  );
  assert.equal(
    scriptedCoreReady({ title: true, price: false, description: true }, listing),
    false
  );
  assert.equal(
    scriptedCoreReady(
      { title: true, price: true, description: true },
      { ...listing, description: "" }
    ),
    true
  );
});
