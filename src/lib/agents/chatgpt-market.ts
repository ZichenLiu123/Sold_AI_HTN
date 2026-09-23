import path from "node:path";
import { completeDetailed, type LlmImage } from "../llm";
import type { CompData, CompListing, ItemAttributes, UserHints } from "../types";
import { extractJson, filterCitedListings, hostnameOf, median, roundClean } from "../util";
import { parseMarketplacePrice } from "./browser";
import { normalizeGoogleQuery } from "./search-query";
import { readPhotoBytes } from "../storage";

/**
 * Sold Agent market intel: same photos + live web_search tool in one call.
 * Identify the product, then look up real asking/sold prices with citations.
 * Browser scraping is only a fallback when this returns thin evidence.
 */

const MARKET_PROMPT = `You are helping a US seller price a used/resale listing from photos.

Your job:
1. Look at the photos and identify the exact product (brand, model/line, size, flavor, condition).
2. Use web search to find what that product currently sells for in the United States — eBay sold/completed, Google Shopping, Mercari, Facebook Marketplace, Amazon, Target, Walmart, grocery sites for food/drink.
3. Prefer exact product matches. Reject wrong generations, collabs, and accessories.

Return JSON only (no markdown):
{
  "category": "",
  "brand": null,
  "model": null,
  "condition": "new | like new | good | fair | poor",
  "color": null,
  "flaws": [],
  "notable_features": [],
  "visible_text": [],
  "search_query": "",
  "confidence": "high" | "medium" | "low",
  "price_reasoning": "",
  "suggested_price": 0,
  "listings": [
    { "title": "", "price": 0, "url": "https://...", "sold": false, "source": "" }
  ]
}

Rules:
- search_query: the Google query you would type (brand + model + size + product type). No "for sale"/"used" fluff.
- listings: 6–12 real comps with https URLs you actually found via search. Include sold eBay when possible.
- price is one USD number (not shipping, not a range).
- sold: true only for completed sales.
- suggested_price: a fair resale ask from the comps (usually near the sold median, or retail ask for groceries). 0 if you cannot price it.
- Never invent URLs, domains, or prices. If search finds nothing, listings: [] and suggested_price: 0.
- Never invent RAM/year/storage you cannot see.`;

function mimeFor(filePath: string): LlmImage["media_type"] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function photoToImage(photoUrl: string): Promise<LlmImage> {
  const bytes = await readPhotoBytes(photoUrl);
  return {
    media_type: mimeFor(photoUrl),
    data: Buffer.from(bytes).toString("base64"),
  };
}

function identifyingLines(
  brand: string | null,
  model: string | null,
  extra: unknown
): string[] {
  const fromExtra = Array.isArray(extra)
    ? extra.map((line) => (typeof line === "string" ? line.replace(/\s+/g, " ").trim() : ""))
    : [];
  return [...new Set([brand || "", model || "", ...fromExtra])]
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
    .slice(0, 8);
}

const KNOWN_HOST =
  /(ebay|mercari|facebook|craigslist|amazon|walmart|target|google|poshmark|offerup|etsy|bestbuy|homedepot|costco|samsclub|instagram)\./i;

function keepListingUrls(
  rows: CompListing[],
  citationUrls: string[]
): CompListing[] {
  const cited = filterCitedListings(rows, citationUrls);
  if (cited.length >= 3) return cited;
  // The model sometimes cites the search page host only — keep well-known marketplaces.
  const known = rows.filter(
    (row) => /^https:\/\//i.test(row.url) && KNOWN_HOST.test(hostnameOf(row.url))
  );
  return known.length ? known : cited;
}

export type ChatGptMarketResult = {
  attributes: ItemAttributes;
  comps: CompData;
  suggested_price: number;
  price_reasoning: string;
};

export function chatgptMarketAvailable() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function identifyAndPriceFromPhotos(
  photos: string[],
  hints: UserHints
): Promise<ChatGptMarketResult> {
  if (!chatgptMarketAvailable()) {
    throw new Error("OPENAI_API_KEY is required for Sold Agent market intel.");
  }

  const hintText = Object.entries(hints)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const { text, urls } = await completeDetailed({
    system: MARKET_PROMPT,
    maxTokens: 2200,
    webSearch: true,
    images: await Promise.all(
      photos.slice(0, 4).map(async (photo, index) => ({
        ...(await photoToImage(photo)),
        detail: (index === 0 ? "original" : "high") as LlmImage["detail"],
      }))
    ),
    text: hintText
      ? `Seller hints (use to fill gaps; photos win if they conflict):\n${hintText}\n\nIdentify the item from the photos, search the live web for comps, and return the JSON.`
      : "Identify the item from the photos, search the live web for current US prices, and return the JSON.",
  });

  const parsed = extractJson<{
    category?: string;
    brand?: string | null;
    model?: string | null;
    condition?: string;
    color?: string | null;
    flaws?: string[];
    notable_features?: string[];
    visible_text?: string[];
    search_query?: string;
    confidence?: ItemAttributes["confidence"];
    price_reasoning?: string;
    suggested_price?: number;
    listings?: Array<Partial<CompListing> & { source?: string }>;
  }>(text);

  const brand = parsed.brand || hints.brand || null;
  const model = parsed.model || null;
  const category = parsed.category || hints.category || "uncategorized";
  const visible_text = identifyingLines(brand, model, parsed.visible_text);
  const search_query = normalizeGoogleQuery(parsed.search_query, [
    brand,
    model,
    category !== "uncategorized" ? category : null,
    parsed.color,
  ]);

  const attributes: ItemAttributes = {
    category,
    brand,
    model,
    condition: parsed.condition || hints.condition || "good",
    flaws: Array.isArray(parsed.flaws) ? parsed.flaws : [],
    color: parsed.color || null,
    notable_features: Array.isArray(parsed.notable_features)
      ? parsed.notable_features.slice(0, 3)
      : [],
    visible_text,
    search_query,
    confidence: parsed.confidence || (brand || model ? "high" : "medium"),
  };

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
        source: String(row.source || "Web").slice(0, 40),
        sold: Boolean(row.sold),
      } satisfies CompListing;
    })
    .filter((row): row is CompListing => row !== null);

  const compsRows = keepListingUrls(raw, urls);
  const prices = compsRows.map((row) => row.price);
  const soldCount = compsRows.filter((row) => row.sold).length;
  const mid = median(prices);
  const suggested =
    typeof parsed.suggested_price === "number" && parsed.suggested_price > 0
      ? roundClean(parsed.suggested_price)
      : mid
        ? roundClean(mid)
        : 0;

  const comps: CompData = {
    source:
      compsRows.length >= 3
        ? `Sold Agent (${compsRows.length} listings)`
        : "Sold Agent",
    sources: [...new Set(compsRows.map((row) => row.source))],
    query: search_query,
    comps: compsRows,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    median: mid,
    mocked: false,
    confidence:
      soldCount >= 3 && compsRows.length >= 5
        ? "high"
        : compsRows.length >= 3
          ? "medium"
          : compsRows.length > 0
            ? "low"
            : "none",
    failure_reason:
      compsRows.length >= 3
        ? null
        : compsRows.length
          ? `Only ${compsRows.length} cited comps; may scrape Google next.`
          : "Web search returned no cited marketplace prices.",
    attempted_sources: ["Sold Agent"],
    successful_sources: compsRows.length ? ["Sold Agent"] : [],
    diagnostics: [
      {
        source: "Sold Agent",
        attempted: true,
        successful: compsRows.length > 0,
        attempts: 1,
        found: compsRows.length,
        reason:
          compsRows.length > 0
            ? null
            : raw.length
              ? "Listings lacked cited URLs"
              : "No prices found",
        search_url: `https://www.google.com/search?q=${encodeURIComponent(search_query + " price")}`,
      },
    ],
    pricing_basis: soldCount >= 3 ? "sold" : soldCount > 0 ? "mixed" : compsRows.length ? "asking" : "none",
  };

  return {
    attributes,
    comps,
    suggested_price: suggested,
    price_reasoning: String(parsed.price_reasoning || "").slice(0, 400),
  };
}
