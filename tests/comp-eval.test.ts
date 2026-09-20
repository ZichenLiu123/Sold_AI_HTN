import assert from "node:assert/strict";
import test from "node:test";
import {
  applyJudgments,
  guessPackQuantity,
  heuristicJudgment,
  priceEvaluatedComps,
} from "../src/lib/agents/evaluator.ts";
import type { CompData, CompListing } from "../src/lib/types.ts";

test("reads pack quantity from marketplace titles", () => {
  assert.equal(guessPackQuantity("Oasis Orange Juice 24 x 300 ml"), 24);
  assert.equal(guessPackQuantity("Oasis apple juice 10-pack"), 10);
  assert.equal(guessPackQuantity("pack of 6 Oasis juice"), 6);
  assert.equal(guessPackQuantity("Oasis 100% Apple Juice — 300 ml"), 1);
});

test("divides pack price to a per-item unit and drops unrelated keeps via judgments", () => {
  const comps: CompListing[] = [
    {
      title: "Oasis Orange Juice 24 x 300 ml",
      price: 17,
      url: "https://example.com/pack",
      source: "Web shopping",
      sold: false,
    },
    {
      title: "Oasis 100% Apple Juice — 300 ml",
      price: 3,
      url: "https://example.com/single",
      source: "Web shopping",
      sold: false,
    },
    {
      title: "Oasis juice 10-pack",
      price: 12,
      url: "https://example.com/ten",
      source: "Mercari",
      sold: false,
    },
  ];
  const judged = applyJudgments(
    comps,
    comps.map((comp) => heuristicJudgment(comp))
  );
  assert.equal(judged[0].quantity, 24);
  assert.equal(judged[0].unit_price, 0.71);
  assert.equal(judged[1].quantity, 1);
  assert.equal(judged[1].unit_price, 3);
  assert.equal(judged[2].quantity, 10);
  assert.equal(judged[2].unit_price, 1.2);

  const priced = priceEvaluatedComps(
    {
      source: "test",
      sources: ["Web shopping", "Mercari"],
      query: "OASIS 300 mL juice",
      comps,
      min: null,
      max: null,
      median: null,
      mocked: false,
    } satisfies CompData,
    judged
  );
  assert.equal(priced.evaluated, true);
  assert.equal(priced.comps.length, 3);
  assert.ok(priced.median != null);
  assert.ok((priced.median || 0) <= 3);
});

test("drops vintage MacBooks when the item has a notch, and crazy single-serve grocery prices", () => {
  const vintage = heuristicJudgment(
    {
      title: "APPLE MACBOOK LAPTOP EL CAPITAN 10.11 WITH MICROSOFT OFFICE 2011",
      price: 140,
      url: "https://example.com/old",
      source: "Craigslist",
      sold: false,
    },
    {
      category: "laptop",
      brand: "Apple",
      model: "MacBook Air",
      condition: "good",
      flaws: [],
      color: "silver",
      notable_features: ["notch display"],
      visible_text: [],
      confidence: "high",
    }
  );
  assert.equal(vintage.keep, false);

  const priceyJuice = heuristicJudgment(
    {
      title: "Oasis 100% Apple Juice — 300 ml",
      price: 35,
      url: "https://example.com/juice",
      source: "Web shopping",
      sold: false,
    },
    {
      category: "juice",
      brand: "OASIS",
      model: "Apple 300 mL",
      condition: "new",
      flaws: [],
      color: null,
      notable_features: [],
      visible_text: [],
      confidence: "high",
    }
  );
  assert.equal(priceyJuice.keep, false);
});

test("drops kids collabs when the seller has a plain adult bottle", () => {
  const bottle = {
    category: "water bottle",
    brand: "Owala",
    model: "FreeSip 32oz",
    condition: "good",
    flaws: [],
    color: "dark gray",
    notable_features: [],
    visible_text: ["Owala", "FreeSip"],
    confidence: "high" as const,
  };
  const kids = heuristicJudgment(
    {
      title: "Owala Kids FreeSip 16oz Gengar In The Shadows",
      price: 60,
      url: "https://poshmark.com/listing/kids",
      source: "Poshmark",
      sold: false,
    },
    bottle
  );
  const halloween = heuristicJudgment(
    {
      title: "Halloween ROUND WE GHOST 32 oz FreeSip water bottle - Owala",
      price: 66,
      url: "https://www.mercari.com/halloween",
      source: "Mercari",
      sold: false,
    },
    bottle
  );
  const same = heuristicJudgment(
    {
      title: "Owala 32 oz. FreeSip Stainless Steel Water Bottle Light Gray",
      price: 20,
      url: "https://www.ebay.com/itm/1",
      source: "eBay",
      sold: true,
    },
    bottle
  );
  assert.equal(kids.keep, false);
  assert.equal(halloween.keep, false);
  assert.equal(same.keep, true);
});
