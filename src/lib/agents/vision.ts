import path from "node:path";
import { complete, type LlmImage } from "../llm";
import type { ItemAttributes, UserHints } from "../types";
import { extractJson } from "../util";
import { readPhotoBytes } from "../storage";

const VISION_PROMPT = `Look at these product photos and fill the listing fields. These values populate the form. Pricing is handled later — do not guess a price.

Return JSON only:
{
  "category": "",
  "brand": null,
  "model": null,
  "condition": "new | like new | good | fair | poor",
  "color": null,
  "flaws": [],
  "notable_features": [],
  "confidence": "high" | "medium" | "low"
}

- category: what it is (juice, laptop, water bottle, gift box)
- brand: the maker if printed or clearly the logo. Use normal product capitalization (Owala, Apple, OASIS).
- model: the product line a shopper would search. Examples: MacBook Air, FreeSip, Apple 300 mL. Not a slogan ("100% Juice") and not a generic shape ("silver laptop").
- If this is an Apple notebook, model must be MacBook, MacBook Air, or MacBook Pro. A display notch means Air or Pro, not a 2010s MacBook.
- If this is an Owala bottle with the push-button spout lid, model is FreeSip when that line is recognizable.
- Include size/flavor in model when printed (300 mL, 24oz, apple).
- condition: from visible wear, not a guarantee
- flaws: visible damage, stains, scratches, missing parts — do not minimize them
- notable_features: physical traits that are not already brand/model (notch display, corporate logo)
- Never invent a spec you cannot see. Do not guess RAM, year, or storage.
- Ignore nutrition facts, ingredients, bilingual health stamps, barcodes, and recycling marks`;

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
      : "Identify the item in the photos and fill the fields.",
  });

  const parsed = extractJson<ItemAttributes>(raw);
  const brand = parsed.brand || hints.brand || null;
  const model = parsed.model || null;
  return {
    category: parsed.category || hints.category || "uncategorized",
    brand,
    model,
    condition: parsed.condition || hints.condition || "good",
    flaws: Array.isArray(parsed.flaws) ? parsed.flaws : [],
    color: parsed.color || null,
    notable_features: Array.isArray(parsed.notable_features)
      ? parsed.notable_features
      : [],
    visible_text: identifyingLines(brand, model, parsed.visible_text),
    confidence: parsed.confidence || (brand || model ? "high" : "medium"),
  };
}
