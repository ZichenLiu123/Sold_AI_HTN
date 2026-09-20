import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompQueries,
  mergeCompData,
  parseMarketplacePrice,
  verifyComps,
  enoughVerifiedComps,
  relevanceTokens,
} from "../src/lib/agents/browser.ts";
import { filterCitedListings } from "../src/lib/util.ts";
import type { CompListing, ItemAttributes } from "../src/lib/types.ts";

const giftBox: ItemAttributes = {
  category: "gift box",
  brand: null,
  model: null,
  condition: "good",
  flaws: [],
  color: "blue",
  notable_features: ["ribbon closure"],
  visible_text: [],
  confidence: "medium",
};

test("builds descriptive primary and broader alternate queries", () => {
  const queries = buildCompQueries(giftBox);
  assert.equal(queries.primary, "blue ribbon closure gift box");
  assert.equal(queries.alternate, "blue gift box");
  assert.doesNotMatch(queries.primary, /\bgood\b/);
});

test("searches brand and model from OCR before generic color words", () => {
  const queries = buildCompQueries({
    category: "water bottle",
    brand: "Owala",
    model: "FreeSip 32oz",
    condition: "like new",
    flaws: [],
    color: "gray",
    notable_features: ["RBC Capital Markets logo"],
    visible_text: ["OWALA", "FREESIP", "32 OZ"],
    confidence: "high",
  });
  assert.equal(queries.primary, "Owala FreeSip 32oz");
  assert.equal(queries.alternate, "Owala FreeSip 32oz water bottle");
  assert.doesNotMatch(queries.primary, /gray|logo|RBC/i);
});

test("parses one item price and rejects shipping, payments, and ranges", () => {
  assert.equal(parseMarketplacePrice("$1,249.99"), 1250);
  assert.equal(parseMarketplacePrice("$21.99 Was $51"), 22);
  assert.equal(parseMarketplacePrice("$3.77$4.01"), 4);
  assert.equal(parseMarketplacePrice("$18 shipping"), null);
  assert.equal(parseMarketplacePrice("$25 /mo"), null);
  assert.equal(parseMarketplacePrice("$20 - $30"), null);
});

test("keeps relevant URL-backed comps and removes duplicate URLs and outliers", () => {
  const comps: CompListing[] = [
    {
      title: "Blue gift box with ribbon",
      price: 18,
      url: "https://example.com/a?utm_source=test",
      source: "eBay",
      sold: true,
    },
    {
      title: "Blue gift box with ribbon",
      price: 18,
      url: "https://example.com/a?utm_source=other",
      source: "eBay",
      sold: true,
    },
    {
      title: "Navy blue gift presentation box",
      price: 20,
      url: "https://example.com/b",
      source: "Mercari",
      sold: false,
    },
    {
      title: "Blue gift box",
      price: 22,
      url: "https://example.com/c",
      source: "Poshmark",
      sold: false,
    },
    {
      title: "Blue gift box luxury",
      price: 900,
      url: "https://example.com/d",
      source: "Craigslist",
      sold: false,
    },
    {
      title: "Red running shoes",
      price: 20,
      url: "https://example.com/e",
      source: "Mercari",
      sold: false,
    },
    {
      title: "Gift box with ribbon",
      price: 19,
      url: "https://example.com/f",
      source: "Mercari",
      sold: false,
    },
    {
      title: "Hallmark Gift Box",
      price: 22,
      url: "https://www.google.com/shopping/product/1?q=blue+gift+box",
      source: "Google Shopping",
      sold: false,
    },
  ];

  const verified = verifyComps(comps, "blue gift box", [], ["gift", "box"]);
  assert.deepEqual(
    verified.map((comp) => comp.price),
    [18, 20, 22, 19, 22]
  );
});

test("keeps OpenAI web prices only when the URL was cited", () => {
  const kept = filterCitedListings(
    [
      {
        title: "Owala FreeSip 32oz",
        price: 18,
        url: "https://www.ebay.com/itm/123",
        source: "OpenAI web",
        sold: true,
      },
      {
        title: "Fake listing",
        price: 189,
        url: "https://example.com/nope",
        source: "OpenAI web",
        sold: false,
      },
    ],
    ["https://www.ebay.com/itm/123"]
  );
  assert.deepEqual(
    kept.map((row) => row.price),
    [18]
  );
});

test("drops OpenAI listings when the model returned no citations", () => {
  const kept = filterCitedListings(
    [
      {
        title: "Owala FreeSip 32oz",
        price: 189,
        url: "https://www.ebay.com/itm/invented",
        source: "OpenAI web",
        sold: false,
      },
    ],
    []
  );
  assert.equal(kept.length, 0);
});

test("merges Browserbase and OpenAI comps to a median", () => {
  const merged = mergeCompData(
    {
      source: "Mercari",
      sources: ["Mercari"],
      query: "Owala FreeSip 32oz",
      comps: [
        {
          title: "Owala FreeSip 32oz gray",
          price: 16,
          url: "https://www.mercari.com/a",
          source: "Mercari",
          sold: false,
        },
        {
          title: "Owala FreeSip 32oz bottle",
          price: 20,
          url: "https://www.mercari.com/b",
          source: "Mercari",
          sold: false,
        },
      ],
      min: 16,
      max: 20,
      median: 18,
      mocked: false,
      diagnostics: [],
    },
    {
      source: "OpenAI web",
      sources: ["OpenAI web"],
      query: "Owala FreeSip 32oz",
      comps: [
        {
          title: "Owala FreeSip 32oz",
          price: 22,
          url: "https://www.ebay.com/itm/1",
          source: "OpenAI web",
          sold: true,
        },
      ],
      min: 22,
      max: 22,
      median: 22,
      mocked: false,
      diagnostics: [],
    }
  );
  assert.equal(merged.median, 20);
  assert.equal(merged.comps.length, 3);
  assert.ok(merged.successful_sources?.includes("OpenAI web"));
});

test("stops scraping only after five sold comps can lock the price", () => {
  const sold = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      title: `Owala FreeSip 32oz ${i}`,
      price: 16 + i,
      url: `https://www.ebay.com/itm/${i}`,
      source: "eBay",
      sold: true,
    }));
  assert.equal(enoughVerifiedComps(sold(5)), true);
  assert.equal(enoughVerifiedComps(sold(4)), false);
  assert.equal(
    enoughVerifiedComps([
      {
        title: "Owala FreeSip 32oz a",
        price: 18,
        url: "https://www.google.com/shopping/1",
        source: "Web shopping",
        sold: false,
      },
      {
        title: "Owala FreeSip 32oz b",
        price: 20,
        url: "https://www.google.com/shopping/2",
        source: "Web shopping",
        sold: false,
      },
      {
        title: "Owala FreeSip 32oz c",
        price: 22,
        url: "https://www.google.com/shopping/3",
        source: "Web shopping",
        sold: false,
      },
      {
        title: "Owala FreeSip 32oz d",
        price: 19,
        url: "https://www.poshmark.com/listing/d",
        source: "Poshmark",
        sold: false,
      },
      {
        title: "Owala FreeSip 32oz e",
        price: 21,
        url: "https://www.mercari.com/e",
        source: "Mercari",
        sold: false,
      },
    ]),
    false
  );
});

test("merge drops off-identity OpenAI listings when OCR tokens are required", () => {
  const merged = mergeCompData(
    {
      source: "Mercari",
      sources: ["Mercari"],
      query: "Owala FreeSip 32oz",
      comps: [
        {
          title: "Owala FreeSip 32oz gray",
          price: 16,
          url: "https://www.mercari.com/a",
          source: "Mercari",
          sold: false,
        },
        {
          title: "Owala FreeSip 32oz bottle",
          price: 20,
          url: "https://www.mercari.com/b",
          source: "Mercari",
          sold: false,
        },
      ],
      min: 16,
      max: 20,
      median: 18,
      mocked: false,
      diagnostics: [],
    },
    {
      source: "OpenAI web",
      sources: ["OpenAI web"],
      query: "Owala FreeSip 32oz",
      comps: [
        {
          title: "Random ceramic mug",
          price: 12,
          url: "https://www.ebay.com/itm/mug",
          source: "OpenAI web",
          sold: false,
        },
        {
          title: "Owala FreeSip 32oz",
          price: 22,
          url: "https://www.ebay.com/itm/1",
          source: "OpenAI web",
          sold: true,
        },
      ],
      min: 12,
      max: 22,
      median: 17,
      mocked: false,
      diagnostics: [],
    },
    ["owala", "freesip", "32oz"],
    []
  );
  assert.equal(merged.comps.some((comp) => /mug/i.test(comp.title)), false);
  assert.equal(merged.median, 20);
  assert.equal(merged.comps.length, 3);
});

test("does not require category words when OCR already has brand and model", () => {
  const tokens = relevanceTokens({
    category: "water bottle",
    brand: "Owala",
    model: "FreeSip 32oz",
    condition: "good",
    flaws: [],
    color: "gray",
    notable_features: [],
    visible_text: ["OWALA"],
    confidence: "high",
  });
  assert.ok(tokens.any.includes("owala"));
  assert.deepEqual(tokens.all, []);
});

test("brand-only grocery search uses size and drops container words", () => {
  const queries = buildCompQueries({
    category: "juice bottle",
    brand: "OASIS",
    model: null,
    condition: "good",
    flaws: [],
    color: null,
    notable_features: [],
    visible_text: ["OASIS", "300 mL"],
    confidence: "high",
  });
  assert.equal(queries.primary, "OASIS 300 mL juice");
  assert.equal(queries.alternate, "OASIS juice");
});

test("brand-only grocery search still requires the product type, not the container", () => {
  const tokens = relevanceTokens({
    category: "juice bottle",
    brand: "OASIS",
    model: null,
    condition: "good",
    flaws: [],
    color: null,
    notable_features: [],
    visible_text: ["OASIS", "300 mL"],
    confidence: "high",
  });
  assert.deepEqual(tokens.any, ["oasis"]);
  assert.deepEqual(tokens.all, ["juice"]);
});

test("keeps grocery comps under three dollars", () => {
  const verified = verifyComps(
    [
      {
        title: "Oasis apple juice 300ml 6-pack",
        price: 2,
        url: "https://www.walmart.com/ip/oasis",
        source: "Web shopping",
        sold: false,
      },
    ],
    "OASIS 300 mL juice",
    ["oasis"],
    ["juice"]
  );
  assert.equal(verified.length, 1);
  assert.equal(verified[0].price, 2);
});

test("keeps 24-packs for later quantity evaluation and drops unrelated toner", () => {
  const verified = verifyComps(
    [
      {
        title: "S.NATURE Aqua Oasis Toner , 10,14 oz / 300 ml",
        price: 19,
        url: "https://www.mercari.com/us/item/toner",
        source: "Mercari",
        sold: false,
      },
      {
        title: "Oasis Orange Juice 24 x 300 ml",
        price: 17,
        url: "https://www.google.com/search?q=pack",
        source: "Web shopping",
        sold: false,
      },
      {
        title: "Oasis 100% Apple Juice — 300 ml About this result Report a violation",
        price: 3,
        url: "https://www.google.com/search?q=a",
        source: "Web shopping",
        sold: false,
      },
      {
        title: "Oasis 100% Apple Juice — 300 mlAbout this resultReport a violation /ct",
        price: 3,
        url: "https://www.google.com/search?q=b",
        source: "Web shopping",
        sold: false,
      },
    ],
    "OASIS 300 mL juice",
    ["oasis"],
    ["juice"]
  );
  assert.deepEqual(
    verified.map((comp) => comp.price),
    [17, 3]
  );
  assert.match(verified[0].title, /24 x 300 ml/i);
  assert.doesNotMatch(verified[1].title, /About this result/i);
});

test("treats MacBook titles as laptop comps", () => {
  const verified = verifyComps(
    [
      {
        title: "Apple MacBook Air 13 inch Silver",
        price: 720,
        url: "https://www.ebay.com/itm/air",
        source: "eBay",
        sold: true,
      },
    ],
    "Apple laptop",
    ["apple"],
    ["laptop"]
  );
  assert.equal(verified.length, 1);
  assert.equal(verified[0].price, 720);
});
