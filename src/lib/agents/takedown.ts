import type { Page } from "playwright-core";
import type { Listing, Platform, PlatformPost } from "../types";
import { getListing, getPlatformConnection, logAgent, updateListing } from "../db";
import { DEMO_USER } from "../types";
import { getMarketplaceAdapter } from "../marketplace/adapters";
import { isLocalConnection, localPage, withLocalChrome } from "../marketplace/local-browser";
import {
  isRemoteMinutesError,
  markRemoteMinutesExhausted,
  releaseSoldSessions,
  remoteMinutesExhausted,
  resumeMarketplaceSession,
  startMarketplaceSession,
} from "../marketplace/browserbase";
import { operateListingForm } from "./operator";
import { listingAlreadyTakenDown } from "./operator-decide";

const working = new Set<string>();

export async function takedownListing(listing: Listing) {
  if (working.has(listing.id)) {
    throw new Error("Sold is already taking this listing down.");
  }
  working.add(listing.id);
  try {
    return await runTakedown(listing);
  } finally {
    working.delete(listing.id);
  }
}

async function runTakedown(listing: Listing) {
  const platforms = [
    ...new Set(
      listing.platform_posts
        .filter(
          (post) =>
            post.platform !== "Gmail receipt" &&
            post.status === "posted" &&
            /^https:\/\//.test(post.remote_url || "")
        )
        .map((post) => post.platform)
    ),
  ].filter((platform): platform is Platform => platform !== "Gmail receipt");

  await updateListing(listing.id, {
    pipeline_stage: "Taking down live listings",
    pipeline_error: null,
  });
  if (platforms.length === 0) {
    await updateListing(listing.id, {
      status: "rejected",
      pipeline_stage: "Taken down",
      pipeline_error: null,
    });
    return {
      listing: (await getListing(listing.id))!,
      detail: "Removed from Sold.",
    };
  }
  await logAgent(
    listing.id,
    "lister",
    "TAKEDOWN",
    `Taking down ${platforms.join(" and ")}.`
  );

  const outcomes: { platform: Platform; ok: boolean; detail: string }[] = [];
  for (const platform of platforms) {
    const post = listing.platform_posts.find((row) => row.platform === platform);
    try {
      const detail = await takedownOnPlatform(listing, platform, post?.remote_url);
      outcomes.push({ platform, ok: true, detail });
      await logAgent(listing.id, "browser", "TAKEDOWN", `${platform}: ${detail}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not take the listing down.";
      const detail = /402|browser minutes|upgrade your account|browserbase/i.test(message)
        ? "The remote Craigslist browser is out of minutes. Sold is switching to Chrome on this Mac."
        : message;
      outcomes.push({ platform, ok: false, detail });
      await logAgent(listing.id, "browser", "TAKEDOWN", `${platform} failed: ${detail}`);
    }
  }

  const succeeded = new Set(outcomes.filter((row) => row.ok).map((row) => row.platform));
  const failed = outcomes.filter((row) => !row.ok);
  const latest = (await getListing(listing.id))!;
  const posts: PlatformPost[] = latest.platform_posts.map((post) =>
    post.platform === "Gmail receipt"
      ? post
      : succeeded.has(post.platform)
        ? {
            ...post,
            status: "needs_attention",
            remote_state: undefined,
            remote_url: undefined,
            detail: "Taken down from Sold.",
          }
        : post
  );
  for (const platform of listing.platforms) {
    if (succeeded.has(platform) && !posts.some((post) => post.platform === platform)) {
      posts.push({
        platform,
        status: "needs_attention",
        via: "browserbase",
        detail: "Taken down from Sold.",
      });
    }
  }

  const okNames = outcomes.filter((row) => row.ok).map((row) => row.platform);
  const badNames = failed.map((row) => row.platform);
  await updateListing(listing.id, {
    status: failed.length === 0 ? "rejected" : "live",
    pipeline_stage:
      failed.length === 0
        ? "Taken down"
        : okNames.length
          ? `Taken down on ${okNames.join(" and ")}. Still live on ${badNames.join(" and ")}.`
          : "Take down needs another try",
    pipeline_error: failed.length ? failed.map((row) => `${row.platform}: ${row.detail}`).join(" ") : null,
    platform_posts: posts,
  });

  return {
    listing: (await getListing(listing.id))!,
    detail: outcomes.map((row) => `${row.platform}: ${row.detail}`).join(" ") || "Taken down.",
  };
}

async function clickTakedownControl(page: Page) {
  const names = [
    /delete this posting/i,
    /delete listing/i,
    /^delete$/i,
    /^end listing$/i,
    /remove listing/i,
    /^unpublish$/i,
  ];
  for (const name of names) {
    const control = page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
    if (!(await control.isVisible().catch(() => false))) continue;
    await control.click();
    await page.waitForTimeout(500);
    const confirm = page
      .getByRole("button", { name: /^(yes|delete|confirm|end listing|ok)$/i })
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
    }
    return true;
  }
  return false;
}

async function takedownOnPlatform(
  listing: Listing,
  platform: Platform,
  remoteUrl: string | undefined
) {
  const connection = await getPlatformConnection(DEMO_USER.id, platform);
  if (!connection || connection.status !== "connected") {
    throw new Error(`${platform} is not connected.`);
  }

  const id =
    remoteUrl?.match(/(\d{6,})\.html/i)?.[1] ||
    remoteUrl?.match(/item\/(\d+)/i)?.[1] ||
    "";
  const homeUrl =
    platform === "Facebook Marketplace"
      ? "https://www.facebook.com/marketplace/you/selling"
      : platform === "eBay"
        ? "https://www.ebay.com/mys/active"
        : "https://accounts.craigslist.org/login/home";
  const editorUrl =
    platform === "Craigslist" && id
      ? `https://post.craigslist.org/manage/${id}`
      : undefined;

  const work = async (page: Page) => {
    await logAgent(
      listing.id,
      "browser",
      "TAKEDOWN",
      `Opening ${platform} to delete “${listing.title}”.`
    );
    if (platform === "Facebook Marketplace" && remoteUrl) {
      await page.goto(remoteUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForTimeout(800);
      const itemText = await page.locator("body").innerText().catch(() => "");
      if (listingAlreadyTakenDown(`${page.url()}\n${itemText}`)) {
        return `Gone from ${platform}. It looks deleted or taken down.`;
      }
    }
    await page.goto(editorUrl || homeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForTimeout(800);
    const homeText = await page.locator("body").innerText().catch(() => "");
    if (listingAlreadyTakenDown(`${page.url()}\n${homeText}`)) {
      return `Gone from ${platform}. It looks deleted or taken down.`;
    }
    if (await clickTakedownControl(page)) {
      return `Deleted on ${platform}.`;
    }
    const operated = await operateListingForm(page, listing, platform, {
      mode: "takedown",
      note: `Delete or end the live listing “${listing.title}”. If it is already gone or no longer available, stop. Do not open buyer chats. Do not type on Facebook.`,
      editorUrl,
      homeUrl,
    });
    if (!operated.published) throw new Error(operated.detail);
    return operated.detail || `Deleted on ${platform}.`;
  };

  const viaChrome = async () =>
    withLocalChrome(
      "post",
      async () => {
        const adapter = getMarketplaceAdapter(platform);
        const page = await localPage(platform, adapter.loginUrl);
        const login = await adapter.detectLogin(page);
        if (!login.loggedIn) {
          throw new Error(
            platform === "Craigslist"
              ? "Craigslist remote minutes are used up. Connect Craigslist in Chrome on this Mac, then take it down."
              : `Connect ${platform} again, then take it down.`
          );
        }
        return work(page);
      },
      { waitMs: 90_000 }
    );

  if (isLocalConnection(connection.metadata) || platform === "eBay" || remoteMinutesExhausted()) {
    return viaChrome();
  }

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
    return await work(session.page);
  } catch (error) {
    if (isRemoteMinutesError(error)) markRemoteMinutesExhausted();
    await logAgent(
      listing.id,
      "browser",
      "TAKEDOWN",
      `${platform} remote browser is unavailable. Using Chrome on this Mac.`
    );
    return viaChrome();
  }
}
