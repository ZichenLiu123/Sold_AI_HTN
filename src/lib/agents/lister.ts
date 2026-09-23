import { complete } from "../llm";
import type {
  CompData,
  GeneratedListing,
  ItemAttributes,
  Platform,
  UserHints,
} from "../types";
import { extractJson, itemSize, roundClean } from "../util";

export const LISTER_SYSTEM_PROMPT = `You write marketplace listings people actually post — Facebook Marketplace, Kijiji, OfferUp, Craigslist, Mercari, Poshmark, eBay — not a lab notebook.

You receive item facts from the photo (brand, size, condition, flaws) and optional seller notes. Comp prices may be missing.

Write:
- title: max 80 characters. Brand + what it is + size. No emojis, no ALL CAPS, no quotes around label phrases.
- description: 2–4 short sentences a seller would type on their phone.
- suggested_price: verified comp median, or the seller’s asking price. If neither exists, 0. Never invent a price.
- price_reasoning: 1–2 sentences
- suggested_platforms: from [Facebook Marketplace, Kijiji, OfferUp, Craigslist, Mercari, Poshmark, eBay]. Clothing/fashion → Facebook + Poshmark (+ Mercari). Furniture/large local items → Facebook + Kijiji + OfferUp + Craigslist. Food/drinks/household consumables → Facebook + Kijiji + OfferUp. Electronics/collectibles → eBay + Mercari + Facebook.

Description rules:
- Lead with what someone is buying: brand, product, size, flavor if obvious.
- Condition in plain words (“unopened”, “good shape”, “scratch on the lid”). If no flaws were seen, one short clause is enough — never “no specific visible flaws noted” or “based on the photos provided”.
- Do not quote nutrition facts, vitamin claims, or bilingual label fine print.
- Do not mention pickup, Brooklyn, Prospect Heights, sidewalk, weekends, or neighborhoods. Pickup is shown separately.
- If the label printed a size or brand, state it. Do not hedge those (“appears to be 300 mL”).
- No meta talk about photos, pipelines, comps, or what the model can see.

Never invent specs. Never treat failed price searches as real sales.

Output valid JSON only:
{
  "title": "",
  "description": "",
  "suggested_price": 0,
  "price_reasoning": "",
  "suggested_platforms": []
}`;

const ALLOWED: Platform[] = [
  "Facebook Marketplace",
  "Kijiji",
  "OfferUp",
  "Craigslist",
  "Mercari",
  "Poshmark",
  "eBay",
];

export async function generateListingCopy(
  attributes: ItemAttributes,
  hints: UserHints,
  comps: CompData | null
): Promise<GeneratedListing> {
  const size = itemSize(attributes.model, attributes.visible_text) || null;
  const raw = await complete({
    system: LISTER_SYSTEM_PROMPT,
    maxTokens: 900,
    text: JSON.stringify(
      {
        item: {
          category: attributes.category,
          brand: attributes.brand,
          model: attributes.model,
          size,
          condition: attributes.condition,
          flaws: attributes.flaws,
          color: attributes.color,
          notable_features: attributes.notable_features,
        },
        seller: {
          asking_price: hints.asking_price,
          reason_for_selling: hints.reason_for_selling,
          notes: hints.seller_notes,
        },
        comps: comps
          ? {
              median: comps.median,
              min: comps.min,
              max: comps.max,
              mocked: comps.mocked,
              sample: comps.comps.slice(0, 5).map((comp) => ({
                title: comp.title,
                pack_price: comp.price,
                quantity: comp.quantity || 1,
                unit_price: comp.unit_price ?? comp.price,
                sold: comp.sold,
                note: comp.eval_note,
              })),
            }
          : null,
      },
      null,
      2
    ),
  });

  const parsed = extractJson<GeneratedListing>(raw);
  const platforms = (parsed.suggested_platforms || []).filter((p): p is Platform =>
    ALLOWED.includes(p as Platform)
  );
  const askingPrice = Number(hints.asking_price) || 0;
  const verified =
    Boolean(comps) &&
    !comps!.mocked &&
    comps!.comps.length >= 3 &&
    Boolean(comps!.median);
  const price = askingPrice
    ? roundClean(askingPrice)
    : verified
      ? roundClean(comps!.median!)
      : 0;
  const priceReasoning = askingPrice
    ? "Using the seller’s asking price. Review it before publishing."
    : verified
      ? `Based on ${comps!.comps.length} comps after checking quantity (packs divided to a per-item price), with a median of $${comps!.median}.`
      : "No reliable market price was found. Enter a price manually before publishing.";

  return {
    title: (parsed.title || "Item for sale").slice(0, 80),
    description: parsed.description || "See photos for condition.",
    suggested_price: price,
    price_reasoning: priceReasoning,
    suggested_platforms: platforms.length ? platforms : fallbackPlatforms(attributes.category),
  };
}

function fallbackPlatforms(category: string): Platform[] {
  const c = category.toLowerCase();
  if (/(cloth|apparel|shoe|sneaker|bag|access|fashion|dress|jacket)/.test(c)) {
    return ["Facebook Marketplace", "Poshmark", "Mercari"];
  }
  if (/(furniture|sofa|table|chair|mattress|appliance)/.test(c)) {
    return ["Facebook Marketplace", "Kijiji", "OfferUp", "Craigslist"];
  }
  if (/(juice|grocery|food|drink|beverage|snack|water)/.test(c)) {
    return ["Facebook Marketplace", "Kijiji", "OfferUp"];
  }
  if (/(phone|laptop|camera|console|collect|card|watch|electronic)/.test(c)) {
    return ["eBay", "Mercari", "Facebook Marketplace"];
  }
  return ["Facebook Marketplace", "OfferUp", "Kijiji", "eBay"];
}
