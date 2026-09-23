import { complete } from "../llm.ts";
import type { CompData, CompListing, ItemAttributes } from "../types.ts";
import { extractJson, itemSize, median, roundClean } from "../util.ts";

export type CompJudgment = {
  keep: boolean;
  quantity: number;
  unit_price: number;
  reason: string;
};

const EVAL_PROMPT = `You evaluate marketplace search hits as comps for ONE item a seller is listing.

The seller is selling quantity 1 of that item.

For each listing:
- keep: true only if it is the same product a buyer would treat as interchangeable.
  Drop the wrong brand, toner, cases, and unrelated accessories.
  Drop the wrong generation when it is obvious (a 2011 MacBook / El Capitan listing is not a comp for a current MacBook with a notch).
  Drop kids sizes, Pokémon/Halloween collabs, and holiday exclusives unless the seller's item is that variant.
- quantity: how many of the seller's unit this listing contains. "24 x 300 ml" → 24. "6x300 ml" → 6. A single bottle → 1.
- unit_price: listing price divided by quantity. One number.
- reason: short.

A 10-pack or 24-pack is a GOOD comp once you divide. Do not reject it just because it is a pack.
If a "single" 300 mL juice is $20+, it is almost certainly a pack or a bad parse — infer quantity or drop it.
If the pack size is unclear and the price still looks like one unit of this item, keep quantity 1.

Return JSON only, same order as the listings array:
{
  "judgments": [
    { "keep": true, "quantity": 1, "unit_price": 0, "reason": "" }
  ]
}`;

export function guessPackQuantity(title: string): number {
  const t = title.toLowerCase();
  const patterns = [
    /(\d+)\s*[x×]\s*\d/,
    /pack of\s*(\d+)/,
    /case of\s*(\d+)/,
    /(\d+)\s*[- ]?packs?\b/,
    /(\d+)\s*pks?\b/,
    /(\d+)\s*count\b/,
    /(\d+)\s*[x×]\b/,
  ];
  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (!match) continue;
    const n = Number(match[1]);
    if (n >= 2 && n <= 48) return n;
  }
  return 1;
}

export function listingUnitPrice(comp: CompListing): number {
  if (typeof comp.unit_price === "number" && comp.unit_price > 0) {
    return comp.unit_price;
  }
  return comp.price;
}

function parseOunces(text: string): number | null {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? n : null;
}

const COLLECTIBLE =
  /\bkids\b|pokemon|pokémon|halloween|gengar|holiday edition|\bviral\b/;

export function mismatchedVariantReason(
  comp: CompListing,
  attributes?: ItemAttributes
): string | null {
  if (!attributes) return null;
  const title = comp.title.toLowerCase();
  const seller = [
    attributes.model,
    attributes.color,
    attributes.category,
    ...(attributes.notable_features || []),
    ...(attributes.visible_text || []),
  ]
    .join(" ")
    .toLowerCase();
  if (COLLECTIBLE.test(title) && !COLLECTIBLE.test(seller)) {
    return "Kids, collab, or limited edition — not the seller's item";
  }
  const sellerOz = parseOunces(
    itemSize(attributes.model, [
      attributes.color || "",
      ...(attributes.visible_text || []),
      ...(attributes.notable_features || []),
    ])
  );
  const listingOz = parseOunces(title);
  if (
    sellerOz &&
    listingOz &&
    (listingOz < sellerOz * 0.55 || listingOz > sellerOz * 1.6)
  ) {
    return `Size ${listingOz}oz is too far from ${sellerOz}oz`;
  }
  return null;
}

export function heuristicJudgment(
  comp: CompListing,
  attributes?: ItemAttributes
): CompJudgment {
  const quantity = guessPackQuantity(comp.title);
  const unit_price = Math.round((comp.price / quantity) * 100) / 100;
  const title = comp.title.toLowerCase();
  const mismatch = mismatchedVariantReason(comp, attributes);
  if (mismatch) {
    return { keep: false, quantity, unit_price, reason: mismatch };
  }
  const modern = (attributes?.notable_features || []).some((feature) =>
    /notch/i.test(feature)
  );
  if (
    modern &&
    /el capitan|office 2011|core 2|mac os x|2011|2012\b|2013\b|2014\b|2015\b/i.test(
      title
    )
  ) {
    return {
      keep: false,
      quantity,
      unit_price,
      reason: "Wrong generation for a current MacBook",
    };
  }
  const grocery = /juice|grocery|drink|beverage|snack/i.test(
    attributes?.category || ""
  );
  if (grocery && quantity === 1 && unit_price >= 12) {
    return {
      keep: false,
      quantity,
      unit_price,
      reason: "Unit price too high for a single grocery item; likely a pack or bad parse",
    };
  }
  const category = (attributes?.category || "").toLowerCase();
  if (
    /bottle|tumbler/.test(category) &&
    /dinnerware|decor|home acces|clothing|shoe/i.test(title) &&
    !/bottle|tumbler|freesip|sip/i.test(title)
  ) {
    return {
      keep: false,
      quantity,
      unit_price,
      reason: "Title looks like a different category, not this bottle",
    };
  }
  return {
    keep: unit_price >= 0.25,
    quantity,
    unit_price,
    reason:
      quantity > 1
        ? `${quantity}-pack → $${unit_price} each`
        : "single unit",
  };
}

export function applyJudgments(
  comps: CompListing[],
  judgments: CompJudgment[]
): CompListing[] {
  return comps.flatMap((comp, index) => {
    const judged = judgments[index] || heuristicJudgment(comp);
    const quantity = Math.max(1, Math.round(judged.quantity || 1));
    const unit_price =
      judged.unit_price > 0
        ? Math.round(judged.unit_price * 100) / 100
        : Math.round((comp.price / quantity) * 100) / 100;
    if (!judged.keep || unit_price < 0.25) return [];
    return [
      {
        ...comp,
        quantity,
        unit_price,
        eval_note: judged.reason,
      },
    ];
  });
}

function removeUnitOutliers(rows: CompListing[]): CompListing[] {
  if (rows.length < 3) return rows;
  const prices = rows.map(listingUnitPrice).sort((a, b) => a - b);
  const lowHalf = prices.slice(0, Math.max(1, Math.ceil(prices.length / 2)));
  const anchor = lowHalf[Math.floor((lowHalf.length - 1) / 2)] || prices[0];
  const upper = Math.max(anchor * 4, anchor + 5);
  const lower = Math.max(0.25, anchor / 4);
  return rows.filter((row) => {
    const price = listingUnitPrice(row);
    return price >= lower && price <= upper;
  });
}

export function priceEvaluatedComps(
  source: CompData,
  judged: CompListing[]
): CompData {
  const rows = removeUnitOutliers(judged);
  const prices = rows.map(listingUnitPrice);
  const successful = [...new Set(rows.map((row) => row.source))];
  if (rows.length < 3 || prices.length === 0) {
    return {
      ...source,
      comps: rows,
      sources: successful,
      successful_sources: successful,
      min: null,
      max: null,
      median: null,
      mocked: false,
      confidence: "none",
      evaluated: true,
      pricing_basis: "none",
      failure_reason:
        rows.length === 0
          ? "The evaluator dropped every comparable (wrong product or unusable pack size)."
          : `Only ${rows.length} comps still made sense after checking quantity; at least 3 are required.`,
    };
  }
  const mid = roundClean(median(prices) || prices[0] || 0);
  const soldCount = rows.filter((row) => row.sold).length;
  return {
    ...source,
    comps: [...rows].sort((a, b) => listingUnitPrice(a) - listingUnitPrice(b)),
    sources: successful,
    successful_sources: successful,
    min: Math.min(...prices),
    max: Math.max(...prices),
    median: mid,
    mocked: false,
    evaluated: true,
    confidence:
      soldCount >= 3 && rows.length >= 5
        ? "high"
        : soldCount >= 1 || successful.length >= 2
          ? "medium"
          : "low",
    failure_reason: null,
    pricing_basis: source.pricing_basis === "none" ? "asking" : source.pricing_basis,
  };
}

async function llmJudgments(
  attributes: ItemAttributes,
  comps: CompListing[]
): Promise<CompJudgment[] | null> {
  if (comps.length === 0) return [];
  try {
    const raw = await complete({
      system: EVAL_PROMPT,
      maxTokens: 900,
      text: JSON.stringify(
        {
          item: {
            brand: attributes.brand,
            model: attributes.model,
            category: attributes.category,
            size: itemSize(attributes.model, attributes.visible_text) || null,
            notable_features: attributes.notable_features,
            quantity: 1,
          },
          listings: comps.map((comp) => ({
            title: comp.title,
            price: comp.price,
            source: comp.source,
            sold: comp.sold,
          })),
        },
        null,
        2
      ),
    });
    const parsed = extractJson<{ judgments?: CompJudgment[] }>(raw);
    const rows = parsed.judgments || [];
    if (rows.length !== comps.length) return null;
    return rows.map((row, index) => {
      const fallback = heuristicJudgment(comps[index], attributes);
      const quantity = Math.max(1, Number(row.quantity) || fallback.quantity);
      const unit_price = Number(row.unit_price);
      return {
        keep: Boolean(row.keep),
        quantity,
        unit_price:
          Number.isFinite(unit_price) && unit_price > 0
            ? unit_price
            : fallback.unit_price,
        reason: String(row.reason || fallback.reason),
      };
    });
  } catch {
    return null;
  }
}

export async function evaluateComps(
  attributes: ItemAttributes,
  comps: CompData,
  options?: { llm?: boolean }
): Promise<CompData> {
  const incoming = comps.comps || [];
  const useLlm = options?.llm !== false;
  const judgments = useLlm
    ? (await llmJudgments(attributes, incoming)) ||
      incoming.map((comp) => heuristicJudgment(comp, attributes))
    : incoming.map((comp) => heuristicJudgment(comp, attributes));
  const judged = applyJudgments(incoming, judgments).filter(
    (comp) => !mismatchedVariantReason(comp, attributes)
  );
  return priceEvaluatedComps(comps, judged);
}
