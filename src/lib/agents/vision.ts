import path from "node:path";
import { complete, type LlmImage } from "../llm";
import type { ItemAttributes, UserHints } from "../types";
import { extractJson } from "../util";
import { readPhotoBytes } from "../storage";
import { normalizeGoogleQuery } from "./search-query";

export { normalizeGoogleQuery } from "./search-query";

const VISION_PROMPT = `You identify a resale item from photos so we can price it on Google.

Return JSON only:
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
  "confidence": "high" | "medium" | "low"
}

Field rules:
- category: short noun a shopper uses (juice, laptop, water bottle, gift box). Not marketing copy.
- brand: maker if printed or an unmistakable logo. Normal product casing (Owala, Apple, OASIS). null if unsure.
- model: the product line a shopper would type. Examples: MacBook Air, FreeSip, Apple 300 mL. Not slogans ("100% Juice") or vague shapes ("silver laptop").
- Apple notebooks: model must be MacBook, MacBook Air, or MacBook Pro. A display notch means Air or Pro, not a 2010s MacBook.
- Owala with the push-button spout lid: model is FreeSip when recognizable. Include size when printed (32oz, 24oz).
- Include size/flavor in model when clearly printed (300 mL, apple).
- condition: from visible wear only.
- flaws: visible damage only — do not minimize.
- notable_features: physical traits not already in brand/model (notch display, corporate logo). Max 3.
- visible_text: short OCR snippets that identify the product (brand, model, size). Skip nutrition facts, ingredients, barcodes, recycling marks.
- search_query: ONE Google Shopping query a careful shopper would type. Prefer: Brand + Model + Size + product type. Examples:
  - "Owala FreeSip 32oz water bottle"
  - "OASIS apple juice 300ml"
  - "Apple MacBook Air 13 inch"
  Do NOT include: condition words, "for sale", "used", "cheap", city, pickup, price, or fluff adjectives.
  If brand/model are unclear, use the best concrete description (color + category + 1 feature). Max 8 words.
- Never invent RAM, year, storage, or other specs you cannot see.
- confidence: high only when brand or model is readable on the item.`;

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
  const fromModel = Array.isArray(extra)
    ? extra.map((line) => (typeof line === "string" ? line.replace(/\s+/g, " ").trim() : ""))
    : [];
  return [...new Set([brand || "", model || "", ...fromModel])]
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
    .slice(0, 8);
}

export async function extractAttributes(
  photos: string[],
  hints: UserHints
): Promise<ItemAttributes> {
  const hintText = Object.entries(hints)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const raw = await complete({
    system: VISION_PROMPT,
    maxTokens: 900,
    images: await Promise.all(
      photos.slice(0, 4).map(async (photo, index) => ({
        ...(await photoToImage(photo)),
        detail: (index === 0 ? "original" : "high") as LlmImage["detail"],
      }))
    ),
    text: hintText
      ? `Seller hints (use to fill gaps, do not override what the photo clearly shows):\n${hintText}`
      : "Identify the item and write the Google search_query a shopper would use.",
  });

  const parsed = extractJson<ItemAttributes & { search_query?: string }>(raw);
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

  return {
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
}
