import type { Page } from "playwright-core";
import type { Listing, Platform } from "../types";

type FillByName = (page: Page, names: string[], value: string) => Promise<boolean>;

/**
 * Seed the obvious listing fields with Playwright only — no LLM.
 * Returns which required fields stuck. Caller may still run the operator
 * for dropdowns, captchas, or publish.
 */
export async function scriptedSeedFields(
  page: Page,
  listing: Listing,
  platform: Platform,
  fillByName: FillByName
): Promise<{ title: boolean; price: boolean; description: boolean; detail: string }> {
  const titleNames =
    platform === "Craigslist"
      ? ["Posting title", "Title"]
      : platform === "eBay"
        ? ["Title", "Item title"]
        : ["Title"];
  const priceNames = ["Price"];
  const descriptionNames =
    platform === "Craigslist"
      ? ["Posting body", "Description", "Body"]
      : ["Description"];

  const title = listing.title
    ? await fillByName(page, titleNames, listing.title)
    : false;
  const price =
    listing.price > 0
      ? await fillByName(page, priceNames, String(listing.price))
      : false;
  const description = listing.description
    ? await fillByName(page, descriptionNames, listing.description)
    : false;

  const filled = [
    title && "title",
    price && "price",
    description && "description",
  ].filter(Boolean);
  const detail = filled.length
    ? `Scripted fill set ${filled.join(", ")} without an LLM call.`
    : "Scripted fill could not find title/price/description fields.";

  try {
    const { logAgent } = await import("../db");
    await logAgent(listing.id, "browser", "FORM", detail);
  } catch {
    /* logging is best-effort during fill */
  }

  return { title, price, description, detail };
}

/** True when the core create fields are present so we can skip or shorten the operator. */
export function scriptedCoreReady(
  seeded: { title: boolean; price: boolean; description: boolean },
  listing: Listing
) {
  const needTitle = Boolean(listing.title);
  const needPrice = listing.price > 0;
  const needDescription = Boolean(listing.description);
  return (
    (!needTitle || seeded.title) &&
    (!needPrice || seeded.price) &&
    (!needDescription || seeded.description)
  );
}
