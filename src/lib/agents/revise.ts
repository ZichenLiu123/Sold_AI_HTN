import type { Page } from "playwright-core";
import type { Listing, Platform } from "../types";
import { complete } from "../llm";
import { extractJson } from "../util";
import { getListing, getPlatformConnection, getSellerProfile, logAgent, updateListing } from "../db";
import { sellerPickupLine } from "../profile";
import { DEMO_USER } from "../types";
import { getMarketplaceAdapter } from "../marketplace/adapters";
import { isLocalConnection, localPage, withLocalChrome } from "../marketplace/local-browser";
import { operateListingForm } from "./operator";
import { clearCancel, isAgentCancelled, throwIfCancelled } from "./cancel";
import {
  releaseSoldSessions,
  remoteMinutesExhausted,
  resumeMarketplaceSession,
  startMarketplaceSession,
} from "../marketplace/browserbase";

export type ListingRevise = {
  price?: number;
  title?: string;
  description?: string;
  pickup?: string;
  brand?: string;
  category?: string;
  condition?: string;
  model?: string;
};

export function hasListingEdits(edits: ListingRevise) {
  return Object.values(edits).some((value) => value !== undefined && value !== null);
}

export async function parseListingRevise(
  listing: Listing,
  prompt: string
): Promise<ListingRevise> {
  const raw = await complete({
    system:
      "Extract listing edits from the seller. Return JSON only. Omit fields they did not change.",
    text: [
      `Current title: ${listing.title}`,
      `Current price: ${listing.price}`,
      `Current pickup: ${listing.hints?.pickup_notes || sellerPickupLine(await getSellerProfile()) || ""}`,
      `Current description: ${listing.description.slice(0, 280)}`,
      `Seller said: ${prompt}`,
      'JSON: {"price":0,"title":"","description":"","pickup":""}',
    ].join("\n"),
    maxTokens: 300,
  });
  const parsed = extractJson<ListingRevise>(raw);
  const next: ListingRevise = {};
  if (Number.isFinite(parsed.price) && (parsed.price || 0) > 0) {
    next.price = Math.round(Number(parsed.price) * 100) / 100;
  }
  if (parsed.title?.trim()) next.title = parsed.title.trim().slice(0, 80);
  if (parsed.description?.trim()) next.description = parsed.description.trim();
  if (parsed.pickup?.trim()) next.pickup = parsed.pickup.trim();
  if (parsed.brand?.trim()) next.brand = parsed.brand.trim();
  if (parsed.category?.trim()) next.category = parsed.category.trim();
  if (parsed.condition?.trim()) next.condition = parsed.condition.trim();
  if (parsed.model?.trim()) next.model = parsed.model.trim();
  return next;
}

const revising = new Set<string>();

export async function reviseListing(listing: Listing, input: ListingRevise | string) {
  if (revising.has(listing.id)) {
    throw new Error("Sold is already updating this live listing.");
  }
  revising.add(listing.id);
  clearCancel(listing.id);
  try {
    const edits =
      typeof input === "string" ? await parseListingRevise(listing, input) : input;
    if (!hasListingEdits(edits)) {
      throw new Error("Change a field, then save.");
    }
    return await runListingRevise(listing, edits);
  } catch (error) {
    if (isAgentCancelled(error)) {
      await updateListing(listing.id, {
        pipeline_stage: "Stopped",
        pipeline_error: null,
      });
      await logAgent(listing.id, "browser", "STOPPED", "You stopped the live edit.");
      return {
        listing: (await getListing(listing.id))!,
        edits: {},
        detail: "Stopped.",
      };
    }
    throw error;
  } finally {
    revising.delete(listing.id);
  }
}

async function runListingRevise(listing: Listing, edits: ListingRevise) {
  const price = edits.price ?? listing.price;
  const floor =
    edits.price && listing.floor_price > edits.price
      ? edits.price
      : listing.floor_price;
  const attributes =
    edits.brand !== undefined ||
    edits.category !== undefined ||
    edits.condition !== undefined ||
    edits.model !== undefined
      ? {
          category: edits.category ?? listing.attributes?.category ?? "",
          brand:
            edits.brand !== undefined ? edits.brand || null : listing.attributes?.brand ?? null,
          model:
            edits.model !== undefined ? edits.model || null : listing.attributes?.model ?? null,
          condition: edits.condition ?? listing.attributes?.condition ?? "",
          flaws: listing.attributes?.flaws ?? [],
          color: listing.attributes?.color ?? null,
          notable_features: listing.attributes?.notable_features ?? [],
          visible_text: listing.attributes?.visible_text ?? [],
          confidence: listing.attributes?.confidence ?? "medium",
        }
      : undefined;
  const next = await updateListing(listing.id, {
    ...(edits.title ? { title: edits.title } : {}),
    ...(edits.description ? { description: edits.description } : {}),
    ...(edits.price ? { price, floor_price: floor } : {}),
    ...(attributes ? { attributes } : {}),
    hints: {
      ...listing.hints,
      ...(edits.pickup ? { pickup_notes: edits.pickup } : {}),
    },
  });
  if (!next) throw new Error("Could not save the listing edits.");
  await logAgent(
    listing.id,
    "lister",
    "REVISE",
    `Changed the ticket here: ${summarizeEdits(edits)}. Opening the live marketplace next.`
  );
  await updateListing(listing.id, {
    pipeline_stage: `Updating live listing · ${summarizeEdits(edits)}`,
  });

  const targets = listing.platform_posts.filter(
    (post) =>
      post.platform !== "Gmail receipt" &&
      post.status === "posted" &&
      post.remote_state !== "review"
  );
  const remote: string[] = [];
  for (const post of targets) {
    if (post.platform === "Gmail receipt") continue;
    throwIfCancelled(listing.id);
    try {
      const detail = await reviseOnPlatform(next, post.platform, post.remote_url, edits);
      remote.push(`${post.platform}: ${detail}`);
      await logAgent(listing.id, "browser", "REVISE", `${post.platform}: ${detail}`);
    } catch (error) {
      if (isAgentCancelled(error)) throw error;
      const message = error instanceof Error ? error.message : "Could not edit the live listing.";
      remote.push(`${post.platform}: ${message}`);
      await logAgent(listing.id, "browser", "REVISE", `${post.platform} failed: ${message}`);
    }
  }

  const liveOk =
    remote.length > 0 &&
    remote.every((line) =>
      /saved|published|live edit is saved|Operator published/i.test(line)
    );
  await updateListing(listing.id, {
    pipeline_error: liveOk
      ? null
      : "Sold has the new details. The live marketplace post was not updated.",
    pipeline_stage: liveOk
      ? "Live · marketplace updated"
      : "Sold updated. Live edit failed.",
  });

  return {
    listing: (await getListing(listing.id))!,
    edits,
    detail: [
      `Changed in Sold: ${summarizeEdits(edits)}.`,
      remote.length
        ? `Live marketplaces: ${remote.join(" ")}`
        : "No live marketplace listing to update yet.",
    ].join(" "),
  };
}

function summarizeEdits(edits: ListingRevise) {
  const parts: string[] = [];
  if (edits.price) parts.push(`price $${edits.price.toFixed(2)}`);
  if (edits.pickup) parts.push(`location ${edits.pickup}`);
  if (edits.title) parts.push(`title “${edits.title}”`);
  if (edits.description) parts.push("description");
  if (edits.brand) parts.push(`brand ${edits.brand}`);
  if (edits.category) parts.push(`category ${edits.category}`);
  if (edits.condition) parts.push(`condition ${edits.condition}`);
  if (edits.model) parts.push(`model ${edits.model}`);
  return parts.join(", ") || "nothing";
}

function postingId(remoteUrl?: string) {
  return remoteUrl?.match(/(\d{6,})\.html/i)?.[1] || remoteUrl?.match(/item\/(\d+)/i)?.[1] || "";
}

async function reviseOnPlatform(
  listing: Listing,
  platform: Platform,
  remoteUrl: string | undefined,
  edits: ListingRevise
) {
  const connection = await getPlatformConnection(DEMO_USER.id, platform);
  if (!connection || connection.status !== "connected") {
    throw new Error(`${platform} is not connected.`);
  }
  const note = [
    edits.price ? `Set price to ${edits.price}` : "",
    edits.pickup ? `Set location / city / pickup to ${edits.pickup}` : "",
    edits.title ? `Set title to ${edits.title}` : "",
    edits.description ? `Set description to ${edits.description}` : "",
    edits.brand ? `Set brand to ${edits.brand}` : "",
    edits.category ? `Set category to ${edits.category}` : "",
    edits.condition ? `Set condition to ${edits.condition}` : "",
    edits.model ? `Set model to ${edits.model}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  await logAgent(
    listing.id,
    "browser",
    "REVISE",
    `Opening ${platform} to ${note.replace(/^Set /i, "").replace(/\. Set /g, ", ") || "save the edit"}.`
  );
  await updateListing(listing.id, {
    pipeline_stage: `Updating ${platform}`,
  });

  const work = async (page: Page) => {
    const id = postingId(remoteUrl);
    const homeUrl = reviseStartUrl(platform);
    const editorUrl =
      platform === "Craigslist" && id
        ? `https://post.craigslist.org/manage/${id}`
        : undefined;
    await logAgent(
      listing.id,
      "browser",
      "REVISE",
      `On ${platform}. The operator will find the edit form and apply ${summarizeEdits(edits)}.`
    );
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(800);
    const operated = await operateListingForm(page, listing, platform, {
      mode: "revise",
      note,
      editorUrl,
      homeUrl,
    });
    if (!operated.published) throw new Error(operated.detail);
    return operated.detail || "Operator saved the live edit.";
  };

  const viaChrome = async () => {
    await logAgent(
      listing.id,
      "browser",
      "REVISE",
      `Using Chrome on this Mac for ${platform}.`
    );
    return withLocalChrome(
      "post",
      async () => {
        const adapter = getMarketplaceAdapter(platform);
        const page = await localPage(platform, adapter.loginUrl);
        const login = await adapter.detectLogin(page);
        if (!login.loggedIn) {
          throw new Error(`Connect ${platform} again, then retry the edit.`);
        }
        return work(page);
      },
      { waitMs: 12_000 }
    );
  };

  if (isLocalConnection(connection.metadata) || platform === "eBay" || remoteMinutesExhausted()) {
    return viaChrome();
  }

  await logAgent(
    listing.id,
    "browser",
    "REVISE",
    `Opening a ${platform} browser. This should take a few seconds.`
  );
  const pulse = setInterval(() => {
    logAgent(
      listing.id,
      "browser",
      "REVISE",
      `Still opening ${platform}…`
    ).catch(() => undefined);
    updateListing(listing.id, {
      pipeline_stage: `Still opening ${platform}…`,
    }).catch(() => undefined);
  }, 5_000);
  try {
    let session = connection.session_id
      ? await resumeMarketplaceSession(connection.session_id).catch(() => null)
      : null;
    if (!session) {
      await Promise.race([
        releaseSoldSessions(platform),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]).catch(() => undefined);
      session = await startMarketplaceSession(connection.context_id!, platform, "posting", {
        timeoutMs: 28_000,
      });
    }
    clearInterval(pulse);
    await logAgent(
      listing.id,
      "browser",
      "REVISE",
      `${platform} browser is open. The operator is taking over.`
    );
    return await work(session.page);
  } catch (error) {
    clearInterval(pulse);
    const message = error instanceof Error ? error.message : "Remote browser failed.";
    await logAgent(
      listing.id,
      "browser",
      "REVISE",
      `${platform} remote browser failed (${message}). Checking Chrome on this Mac.`
    );
    try {
      return await viaChrome();
    } catch (chromeError) {
      const chromeMessage =
        chromeError instanceof Error ? chromeError.message : "Chrome is not signed in.";
      throw new Error(
        `${platform} is signed in on the remote browser Sold used to post, and that browser did not open (${message}). ${chromeMessage}`
      );
    }
  }
}

function reviseStartUrl(platform: Platform) {
  if (platform === "Facebook Marketplace") {
    return "https://www.facebook.com/marketplace/you/selling";
  }
  if (platform === "eBay") return "https://www.ebay.com/mys/active";
  return "https://accounts.craigslist.org/login/home";
}
