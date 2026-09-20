import assert from "node:assert/strict";
import test from "node:test";
import {
  blockedOperatorTarget,
  classifyFormPage,
  describeStuck,
  forbiddenTarget,
  listingAlreadyTakenDown,
  parseOperatorAction,
  refineAction,
  requestedPrice,
  shouldOpenEditorAfterStuck,
  type FormSight,
} from "../src/lib/agents/operator-decide.ts";

const listing = {
  title: "OASIS Apple Juice 300 ml",
  price: 50,
  description: "Sealed juice.",
  attributes: { brand: "OASIS" },
  hints: {},
};

function sight(partial: Partial<FormSight>): FormSight {
  return {
    url: "https://post.craigslist.org/manage/7969491591",
    kind: "editor",
    empty: [],
    errors: [],
    choices: [],
    body: "",
    ...partial,
  };
}

test("classifies Craigslist public vs editor vs account", () => {
  assert.equal(
    classifyFormPage(
      "https://newyork.craigslist.org/brk/for/d/brooklyn-oasis-apple-juice-300-ml/7969491591.html",
      "OASIS"
    ),
    "public"
  );
  assert.equal(
    classifyFormPage("https://post.craigslist.org/manage/7969491591", "edit this posting"),
    "editor"
  );
  assert.equal(
    classifyFormPage("https://accounts.craigslist.org/login/home", "edit"),
    "account"
  );
});

test("parses operator JSON including open_editor", () => {
  assert.deepEqual(parseOperatorAction('Sure {"action":"open_editor"}'), {
    action: "open_editor",
  });
  assert.equal(parseOperatorAction("no json").action, "rejected");
  assert.equal(requestedPrice("price to $50", { price: 12 }), "50");
});

test("does not replace the operator with a hardcoded price type", () => {
  const refined = refineAction(
    { action: "click", target: "edit" },
    sight({
      kind: "account",
      url: "https://accounts.craigslist.org/login/home",
      choices: ["link:edit", "textbox:Price"],
    }),
    listing,
    { mode: "revise", note: "Set price to 50" },
    []
  );
  assert.deepEqual(refined, { action: "click", target: "edit" });
});

test("rejects done or nav clicks and asks the operator to try again", () => {
  assert.equal(forbiddenTarget("Upload from computer"), true);
  const done = refineAction(
    { action: "done" },
    sight({
      kind: "public",
      url: "https://newyork.craigslist.org/brk/for/d/x/7969491591.html",
    }),
    listing,
    { mode: "revise", note: "Set price to 50" },
    []
  );
  assert.equal(done.action, "rejected");

  const nav = refineAction(
    { action: "click", target: "Shipping" },
    sight({ kind: "editor", choices: ["link:Shipping", "button:continue"] }),
    listing,
    { mode: "revise", note: "Set price to 50" },
    []
  );
  assert.equal(nav.action, "rejected");

  const takenDown = refineAction(
    { action: "done" },
    sight({
      kind: "account",
      url: "https://accounts.craigslist.org/login/home",
    }),
    listing,
    { mode: "takedown", note: "Delete the live listing" },
    ["click:delete this posting"]
  );
  assert.equal(takenDown.action, "done");
});

test("finishes take-down when the listing is already gone", () => {
  assert.equal(listingAlreadyTakenDown("Marketplace No longer available. View similar items."), true);
  assert.equal(
    blockedOperatorTarget("Jeremiah · Silver Laptop with Backlit Keyboard and Large Trackpad", {
      mode: "takedown",
    }),
    true
  );
  const done = refineAction(
    { action: "click", target: "More options" },
    sight({
      kind: "other",
      url: "https://www.facebook.com/marketplace/item/1444979087522068",
      body: "Sorry, it's not available.",
    }),
    listing,
    { mode: "takedown", note: "Delete the live listing" },
    []
  );
  assert.equal(done.action, "done");
});

test("tells the operator it is stuck on the wrong page", () => {
  const stuck = describeStuck(
    ["click:share"],
    sight({
      kind: "public",
      url: "https://newyork.craigslist.org/brk/for/d/x/7969491591.html",
    }),
    "Could not click “share”."
  );
  assert.match(stuck, /Wrong page/);
  assert.match(stuck, /open_editor/);
  assert.equal(
    shouldOpenEditorAfterStuck(
      ["stuck-wrong-page", "stuck-wrong-page"],
      sight({ kind: "public" })
    ),
    true
  );
  assert.equal(
    shouldOpenEditorAfterStuck(
      ["open_editor", "stuck-wrong-page", "stuck-wrong-page"],
      sight({ kind: "public" })
    ),
    false
  );
});
