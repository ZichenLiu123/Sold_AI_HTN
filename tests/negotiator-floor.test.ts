import assert from "node:assert/strict";
import test from "node:test";
import { enforceFloor, extractOfferUsd } from "../src/lib/agents/negotiator-floor.ts";
import type { Listing, NegotiatorResult } from "../src/lib/types.ts";

function listing(partial: Partial<Listing> = {}): Listing {
  return {
    id: "1",
    user_id: "demo-seller",
    photos: [],
    title: "Owala",
    description: "Bottle",
    price: 28,
    floor_price: 20,
    status: "live",
    platforms: ["Craigslist"],
    created_at: new Date().toISOString(),
    attributes: null,
    comps: null,
    price_reasoning: "",
    hints: {},
    auto_post: false,
    platform_posts: [],
    pipeline_stage: "",
    pipeline_error: null,
    last_event: null,
    ...partial,
  };
}

function result(partial: Partial<NegotiatorResult>): NegotiatorResult {
  return {
    action: "hold",
    reply_text: "",
    decision: "",
    escalate: false,
    escalate_reason: "",
    ...partial,
  };
}

test("extractOfferUsd prefers the last dollar amount", () => {
  assert.equal(extractOfferUsd("Was $30, I'll do $22"), 22);
  assert.equal(extractOfferUsd("I can pay 18"), 18);
});

test("floor guard blocks accept under floor", () => {
  const out = enforceFloor(
    listing(),
    "I'll take it for $15",
    result({ action: "accept", reply_text: "Deal.", decision: "Accept." })
  );
  assert.equal(out.action, "hold");
  assert.match(out.reply_text, /\$20/);
});

test("floor guard rewrites counters under floor", () => {
  const out = enforceFloor(
    listing(),
    "How about $16?",
    result({
      action: "counter",
      reply_text: "I can do $12.",
      decision: "Countered.",
    })
  );
  assert.equal(out.action, "counter");
  assert.match(out.reply_text, /\$20/);
});

test("accept at or above floor needs stamp, not auto-sold", () => {
  const out = enforceFloor(
    listing(),
    "I'll take it for $22",
    result({ action: "accept", reply_text: "Sounds good.", decision: "Accept." })
  );
  assert.equal(out.action, "accept");
  assert.equal(out.escalate, true);
  assert.match(out.escalate_reason, /stamp/i);
});
