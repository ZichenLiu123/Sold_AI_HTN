import { completeDetailed } from "../llm";
import type { CompData, CompListing, ItemAttributes } from "../types";
import { extractJson, filterCitedListings, itemSize } from "../util";
import { parseMarketplacePrice } from "./browser";

const PRICE_PROMPT = `You look up what a specific product currently sells for in the United States.

Run several live web searches, not one. Cover used marketplaces and current retail:
eBay sold/completed, Mercari, Facebook Marketplace, Craigslist, Kijiji, Karrot, Poshmark, OfferUp, Google Shopping, Amazon, Target, Walmart, and grocery sites when it is food or drink.

Return 8–12 listings from as many different sites as you can find. JSON only:
{
  "listings": [
    { "title": "", "price": 0, "url": "https://...", "sold": false }
  ]
}

Rules:
- Search the exact product, including size when given (e.g. Oasis juice 300ml).
- Prefer used marketplace listings when the item is used. Add new retail if that is all you find, or for groceries.
- Every listing MUST have a real https URL from a page you actually opened or cited.
- price is one current USD number, not a range, not shipping.
- sold is true only if the page is a completed sale.
- Do not pad with duplicates of the same URL or the same store listing.
- If you cannot find real URLs, return {"listings":[]}. Never invent a URL, domain, or price.`;

export async function lookupOpenAIMarketPrice(
  attributes: ItemAttributes
): Promise<CompData> {
  const brandModel = [attributes.brand, attributes.model]
    .filter(Boolean)
    .join(" ")
    .trim();
  const size = itemSize(attributes.model, attributes.visible_text);
  const category = (attributes.category || "")
    .replace(/\b(bottle|bottles|box|boxes|container|can|cans)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const query =
    (attributes.search_query || "").trim() ||
    [brandModel, size, brandModel ? category : ""]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() ||
    [attributes.color, attributes.category].filter(Boolean).join(" ");
  const empty = (): CompData => ({
    source: "Web search",
    sources: [],
    query,
    comps: [],
    min: null,
    max: null,
    median: null,
    mocked: false,
    confidence: "none",
    failure_reason: brandModel || attributes.search_query
      ? "Web search did not return cited product URLs with prices."
      : "No printed model to look up.",
    attempted_sources: ["Web search"],
    successful_sources: [],
    diagnostics: [
      {
        source: "Web search",
        attempted: Boolean(brandModel || attributes.search_query),
        successful: false,
        attempts: brandModel || attributes.search_query ? 1 : 0,
        found: 0,
        reason: brandModel || attributes.search_query
          ? "No cited URL-backed prices"
          : "Skipped until brand, model, or search query is identified",
      },
    ],
    pricing_basis: "none",
  });

  if ((!brandModel && !attributes.search_query) || !process.env.OPENAI_API_KEY) {
    return empty();
  }

  const { text, urls } = await completeDetailed({
    system: PRICE_PROMPT,
    maxTokens: 1600,
    webSearch: true,
    text: JSON.stringify({
      google_query: query,
      product: brandModel || query,
      category: attributes.category,
      condition: attributes.condition,
      color: attributes.color,
    }),
  });

  const parsed = extractJson<{ listings?: Array<Partial<CompListing>> }>(text);
  const raw: CompListing[] = (parsed.listings || [])
    .map((row) => {
      const price =
        typeof row.price === "number"
          ? Math.round(row.price)
          : parseMarketplacePrice(String(row.price || ""));
      if (!price || !row.url || !row.title) return null;
      return {
        title: String(row.title).slice(0, 180),
        price,
        url: String(row.url),
        source: "Web search",
        sold: Boolean(row.sold),
      } satisfies CompListing;
    })
    .filter((row): row is CompListing => row !== null);

  const comps = filterCitedListings(raw, urls);
  return {
    source: "Web search",
    sources: comps.length ? ["Web search"] : [],
    query,
    comps,
    min: comps.length ? Math.min(...comps.map((row) => row.price)) : null,
    max: comps.length ? Math.max(...comps.map((row) => row.price)) : null,
    median: null,
    mocked: false,
    confidence: comps.length ? "low" : "none",
    failure_reason:
      comps.length > 0
        ? null
        : "Web search did not return cited product URLs with prices.",
    attempted_sources: ["Web search"],
    successful_sources: comps.length ? ["Web search"] : [],
    diagnostics: [
      {
        source: "Web search",
        attempted: true,
        successful: comps.length > 0,
        attempts: 1,
        found: comps.length,
        reason:
          comps.length > 0
            ? null
            : raw.length
              ? "Results lacked cited URLs"
              : "No prices found",
        search_url: `https://www.google.com/search?q=${encodeURIComponent(query + " price")}`,
      },
    ],
    pricing_basis: "none",
  };
}
