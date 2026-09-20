import {
  getListing,
  getPlatformConnection,
  insertMessage,
  listListings,
  listMessages,
  logAgent,
  updateListing,
} from "../db";
import { DEMO_USER } from "../types";
import type { Listing } from "../types";
import { isLocalConnection, gotoLocalPage, withLocalChrome } from "../marketplace/local-browser";
import {
  alreadySeenInbound,
  assertFacebookChatUnlocked,
  captureSellingItemUrl,
  FACEBOOK_SELLING_URL,
  facebookSignedIn,
  facebookThreadId,
  lastBuyerText,
  openInboxThread,
  openMarketplaceInbox,
  readOpenThread,
  resolveThreadListing,
  scanSellingPage,
  sellerTookOver,
  sellingPresence,
  type InboxThread,
} from "../marketplace/facebook-inbox";
import {
  listingChatReady,
  liveMarketplaceCount,
  upsertPlatformPosts,
} from "../marketplace/policy";
import { isPublicItemUrl, livePath } from "../platforms";
import type { PlatformPost } from "../types";
import { findCraigslistListingUrl } from "../marketplace/adapters";
import { runNegotiator } from "./graph";
import {
  isInboxChromeBuyer,
  isRealBuyerMessage,
  isThreadChrome,
  looksLikePersonName,
  matchListingToText,
} from "../marketplace/facebook-inbox-match";
import { scanCraigslistInbox } from "../marketplace/craigslist-inbox";
import { scanEbayInbox } from "../marketplace/ebay-inbox";
import { liveOnPlatform, recordMarketplaceInbound } from "../marketplace/inbox-record";
import {
  isRemoteMinutesError,
  markRemoteMinutesExhausted,
  releaseSession,
  remoteMinutesExhausted,
  startMarketplaceSession,
} from "../marketplace/browserbase";
import { getMarketplaceAdapter } from "../marketplace/adapters";

const TICK_MS = 75_000;

export type FacebookMonitorStatus = {
  running: boolean;
  ticking: boolean;
  interval_ms: number;
  last_tick_at: string | null;
  last_error: string | null;
  last_summary: string;
  scraped: number;
  replied: number;
  escalated: number;
  removed: number;
};

const memory = globalThis as unknown as {
  soldFbMonitor?: ReturnType<typeof setInterval>;
  soldFbWarmup?: ReturnType<typeof setTimeout>;
  soldFbTick?: Promise<FacebookMonitorStatus> | null;
  soldInboxTick?: Promise<FacebookMonitorStatus> | null;
  soldFbStatus?: FacebookMonitorStatus;
  soldFbMissing?: Map<string, number>;
  soldClWatchQuiet?: number;
};

function status(patch: Partial<FacebookMonitorStatus> = {}): FacebookMonitorStatus {
  memory.soldFbStatus = {
    running: Boolean(memory.soldFbMonitor),
    ticking: Boolean(memory.soldFbTick),
    interval_ms: TICK_MS,
    last_tick_at: null,
    last_error: null,
    last_summary: "Not started.",
    scraped: 0,
    replied: 0,
    escalated: 0,
    removed: 0,
    ...memory.soldFbStatus,
    ...patch,
    running: Boolean(memory.soldFbMonitor),
    ticking: Boolean(memory.soldFbTick),
  };
  return memory.soldFbStatus;
}

const GONE_DETAIL =
  "Gone from Facebook Marketplace. It looks deleted or taken down.";

function liveFacebookListings(listings: Listing[]) {
  return listings.filter(
    (listing) =>
      listingChatReady(listing) &&
      listing.platform_posts.some(
        (post) =>
          post.platform === "Facebook Marketplace" &&
          post.status === "posted" &&
          post.remote_state !== "review"
      )
  );
}

function listingsMissingFacebookItemUrl(listings: Listing[]) {
  return listings.filter((listing) => {
    if (!listingChatReady(listing)) return false;
    const post = listing.platform_posts.find(
      (row) => row.platform === "Facebook Marketplace" && row.status === "posted"
    );
    return Boolean(post) && !isPublicItemUrl("Facebook Marketplace", post?.remote_url);
  });
}

function pendingFacebookListings(listings: Listing[]) {
  return listings.filter((listing) => {
    if (!listing.platforms.includes("Facebook Marketplace")) return false;
    if (!["posting", "live", "error"].includes(listing.status)) return false;
    const post = listing.platform_posts.find(
      (row) => row.platform === "Facebook Marketplace"
    );
    return !post || post.status !== "posted" || post.remote_state === "review";
  });
}

async function markFacebookListingLive(listing: Listing, scan: Parameters<typeof sellingPresence>[1]) {
  const presence = sellingPresence(listing, scan);
  if (presence !== "active" && presence !== "review") return false;
  const card = scan.cards.find((row) => matchListingToText(row.text, [listing]));
  const href = card?.href || "";
  const remoteId = href.match(/marketplace\/item\/(\d+)/i)?.[1];
  const itemUrl = remoteId
    ? href.startsWith("http")
      ? href.split("#")[0]
      : `https://www.facebook.com${href.split("#")[0]}`
    : undefined;
  const review = presence === "review" && !remoteId;
  const existing = listing.platform_posts.find(
    (post) => post.platform === "Facebook Marketplace"
  );
  if (
    existing?.status === "posted" &&
    existing.remote_state === (review ? "review" : "live") &&
    existing.remote_id === remoteId &&
    (review || existing.remote_id)
  ) {
    if (review) await touchFacebookReview(listing);
    return false;
  }
  const latest = (await getListing(listing.id)) || listing;
  const otherLive = latest.platform_posts.some(
    (post) =>
      post.platform !== "Facebook Marketplace" &&
      post.platform !== "Gmail receipt" &&
      post.status === "posted" &&
      post.remote_state !== "review"
  );
  const facebookPost: PlatformPost = {
    platform: "Facebook Marketplace",
    status: "posted",
    via: "browserbase",
    url: livePath(listing.id, "Facebook Marketplace"),
    remote_url: itemUrl,
    remote_id: remoteId,
    remote_state: review ? "review" : "live",
    checked_at: new Date().toISOString(),
    detail: review
      ? "Facebook Selling still shows this listing in review — not publicly live yet."
      : "Live on Facebook Marketplace.",
  };
  const posts = upsertPlatformPosts(latest.platform_posts, [facebookPost]);
  const liveCount = liveMarketplaceCount(posts);
  await updateListing(listing.id, {
    status: review && !otherLive ? "posting" : "live",
    pipeline_stage: review && !otherLive
      ? "Facebook is reviewing the listing"
      : `Live · ${liveCount} marketplace${liveCount === 1 ? "" : "s"} posted`,
    pipeline_error: null,
    platform_posts: posts,
  });
  await logAgent(
    listing.id,
    "browser",
    review ? "REVIEW" : "LIVE",
    review
      ? `Facebook is reviewing “${listing.title}”. Waiting for a public Marketplace URL.`
      : `Captured “${listing.title}” live on Facebook Marketplace.`
  );
  return true;
}

async function saveFacebookItemUrl(
  listing: Listing,
  captured: { url: string; remoteId: string }
) {
  const latest = (await getListing(listing.id)) || listing;
  const posts: PlatformPost[] = latest.platform_posts.map((post) =>
    post.platform === "Facebook Marketplace"
      ? {
          ...post,
          remote_url: captured.url,
          remote_id: captured.remoteId,
          remote_state: "live",
          checked_at: new Date().toISOString(),
          detail: "Live on Facebook Marketplace.",
        }
      : post
  );
  await updateListing(listing.id, {
    platform_posts: posts,
    pipeline_stage: `Live · ${liveMarketplaceCount(posts)} marketplace${
      liveMarketplaceCount(posts) === 1 ? "" : "s"
    } posted`,
  });
  await logAgent(
    listing.id,
    "browser",
    "LIVE",
    `Captured the public Marketplace URL for “${listing.title}”.`
  );
}

async function captureMissingFacebookItemUrls(
  page: Awaited<ReturnType<typeof gotoLocalPage>>,
  listings: Listing[],
  scan: Parameters<typeof sellingPresence>[1]
) {
  let captured = 0;
  for (const listing of listingsMissingFacebookItemUrl(listings)) {
    const card = scan.cards.find((row) => matchListingToText(row.text, [listing]));
    const href = card?.href || "";
    const fromCard = href.match(/marketplace\/item\/(\d+)/i);
    if (fromCard) {
      const url = href.startsWith("http")
        ? href.split("#")[0]
        : `https://www.facebook.com${href.split("#")[0]}`;
      await saveFacebookItemUrl(listing, { url, remoteId: fromCard[1] });
      captured += 1;
      continue;
    }
    if (!/marketplace\/you\/selling/i.test(page.url())) {
      await page.goto(FACEBOOK_SELLING_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      }).catch(() => undefined);
      await page.waitForTimeout(1_000);
    }
    const found = await captureSellingItemUrl(page, listing);
    if (found) {
      await saveFacebookItemUrl(listing, found);
      captured += 1;
      await page.goto(FACEBOOK_SELLING_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      }).catch(() => undefined);
    }
  }
  return captured;
}

function missingCounts() {
  memory.soldFbMissing ??= new Map();
  return memory.soldFbMissing;
}

async function touchFacebookReview(listing: Listing) {
  const checked = new Date().toISOString();
  const posts: PlatformPost[] = listing.platform_posts.map((post) =>
    post.platform === "Facebook Marketplace"
      ? {
          ...post,
          checked_at: checked,
          detail:
            "Facebook Selling still shows this listing in review — not publicly live yet.",
        }
      : post
  );
  await updateListing(listing.id, {
    platform_posts: posts,
    pipeline_stage: "Facebook is still reviewing the listing",
    pipeline_error: null,
  });
}

async function markFacebookListingGone(listing: Listing, reason: string) {
  const posts: PlatformPost[] = listing.platform_posts.map((post) =>
    post.platform === "Facebook Marketplace" && post.status === "posted"
      ? { ...post, status: "needs_attention", remote_state: undefined, remote_url: undefined, detail: reason }
      : post
  );
  const stillLive = posts.some(
    (post) =>
      post.platform !== "Gmail receipt" &&
      post.status === "posted" &&
      /^https:\/\//.test(post.remote_url || "")
  );
  await updateListing(listing.id, {
    platform_posts: posts,
    status: stillLive ? listing.status : "rejected",
    pipeline_stage: stillLive ? "Facebook listing is gone" : "Taken down",
    pipeline_error: stillLive ? reason : null,
  });
  await logAgent(listing.id, "browser", "WATCH", reason);
}

async function noteSellingPresence(
  listing: Listing,
  scan: Parameters<typeof sellingPresence>[1]
) {
  const presence = sellingPresence(listing, scan);
  const misses = missingCounts();
  if (presence === "active" || presence === "review") {
    misses.delete(listing.id);
    await logAgent(
      listing.id,
      "browser",
      "WATCH",
      `Selling page still shows “${listing.title}”. Checking Marketplace inbox.`
    );
    return false;
  }
  if (presence === "unknown") {
    await logAgent(
      listing.id,
      "browser",
      "WATCH",
      `Could not read the Selling page for “${listing.title}”. Will try again.`
    );
    return false;
  }
  if (presence === "sold") {
    misses.delete(listing.id);
    if (listing.status !== "sold") {
      await updateListing(listing.id, {
        status: "sold",
        pipeline_stage: "Sold",
        pipeline_error: null,
      });
      await logAgent(
        listing.id,
        "browser",
        "WATCH",
        `Facebook marked “${listing.title}” as sold.`
      );
    }
    return false;
  }

  const next = (misses.get(listing.id) || 0) + 1;
  misses.set(listing.id, next);
  const confirmed = presence === "deleted" || scan.empty || next >= 2;
  if (confirmed) {
    misses.delete(listing.id);
    await markFacebookListingGone(listing, GONE_DETAIL);
    return true;
  }
  await logAgent(
    listing.id,
    "browser",
    "WATCH",
    `Didn’t see “${listing.title}” on Selling this pass. Confirming next loop.`
  );
  return false;
}

async function handleThread(page: Awaited<ReturnType<typeof gotoLocalPage>>, thread: InboxThread, listings: Listing[]) {
  if (!looksLikePersonName(thread.buyer)) {
    return { replied: 0, escalated: 0, detail: "chrome" };
  }

  let listing = resolveThreadListing(
    `${thread.raw} ${thread.hint} ${thread.preview} ${thread.buyer}`,
    listings
  );

  const opened = await openInboxThread(page, thread);
  if (!opened) {
    const target = listing || listings[0];
    if (target) {
      await logAgent(
        target.id,
        "browser",
        "WATCH",
        listing
          ? `Saw a Marketplace thread for “${listing.title}” but could not open ${thread.buyer}.`
          : `Saw Marketplace chat with ${thread.buyer} but could not open it to match a listing.`
      );
    }
    return { replied: 0, escalated: 0, detail: "closed" };
  }

  const openedMessages = await readOpenThread(page);
  const itemLinks = await page
    .evaluate(() =>
      [...document.querySelectorAll('a[href*="/marketplace/item/"]')]
        .map((node) => (node as HTMLAnchorElement).href)
        .join(" ")
    )
    .catch(() => "");
  const header = await page
    .locator('[role="main"]')
    .locator("h1, h2")
    .first()
    .innerText()
    .catch(() => "");
  const scoped = [
    thread.hint,
    thread.preview,
    openedMessages.map((message) => message.text).join(" "),
    itemLinks,
    header,
  ].join(" ");
  listing = resolveThreadListing(scoped, listings);
  if (!listing) {
    if (listings[0]) {
      await logAgent(
        listings[0].id,
        "browser",
        "WATCH",
        `Saw Marketplace chat with ${thread.buyer}. Could not tell which Sold listing it belongs to.`
      );
    }
    return { replied: 0, escalated: 0, detail: "unmatched" };
  }

  const conversationId = facebookThreadId(thread.buyer, listing.id);
  const history = (await listMessages(listing.id)).filter(
    (message) => message.conversation_id === conversationId
  );
  if (sellerTookOver(history)) {
    await logAgent(
      listing.id,
      "negotiator",
      "HOLD",
      `Alex already replied in Sold. Left Facebook thread with ${thread.buyer} alone.`
    );
    return { replied: 0, escalated: 0, detail: "human" };
  }

  const inbound = lastBuyerText(openedMessages) || thread.preview.trim();
  if (!inbound || isThreadChrome(inbound) || !isRealBuyerMessage(inbound)) {
    return { replied: 0, escalated: 0, detail: inbound ? "chrome" : "empty" };
  }
  if (alreadySeenInbound(history, inbound)) {
    return { replied: 0, escalated: 0, detail: "seen" };
  }

  await insertMessage({
    id: crypto.randomUUID(),
    listing_id: listing.id,
    conversation_id: conversationId,
    buyer_name: thread.buyer,
    sender: "buyer",
    text: inbound,
    action: null,
    decision: "",
    escalate: false,
    escalate_reason: "",
    timestamp: new Date().toISOString(),
  });
  await logAgent(
    listing.id,
    "browser",
    "WATCH",
    `New Facebook message from ${thread.buyer}: “${inbound.slice(0, 80)}”`
  );

  const fresh = listings.find((row) => row.id === listing.id) || listing;
  const result = await runNegotiator(fresh, inbound);
  await insertMessage({
    id: crypto.randomUUID(),
    listing_id: listing.id,
    conversation_id: conversationId,
    buyer_name: thread.buyer,
    sender: "agent",
    text: result.reply_text,
    action: result.action,
    escalate: result.escalate,
    escalate_reason: result.escalate_reason,
    decision: result.decision,
    timestamp: new Date().toISOString(),
  });

  if (result.action === "accept") {
    await updateListing(listing.id, { status: "sold", pipeline_stage: "Sold" });
  }

  await logAgent(
    listing.id,
    "negotiator",
    result.escalate ? "ESCALATE" : result.action.toUpperCase(),
    `Drafted a reply in Sold for ${thread.buyer}. Did not type on Facebook.`
  );
  return { replied: 0, escalated: result.escalate ? 1 : 0, detail: "stored" };
}

export async function tickFacebookInbox(): Promise<FacebookMonitorStatus> {
  if (memory.soldFbTick) return memory.soldFbTick;
  const run = (async () => {
    try {
      const connection = await getPlatformConnection(
        DEMO_USER.id,
        "Facebook Marketplace"
      );
      if (!connection || connection.status !== "connected") {
        return status({
          last_tick_at: new Date().toISOString(),
          last_error: "Facebook is not connected.",
          last_summary: "Connect Facebook first.",
        });
      }
      if (!isLocalConnection(connection.metadata)) {
        return status({
          last_tick_at: new Date().toISOString(),
          last_error: "Facebook inbox watch uses your Chrome profile.",
          last_summary: "Reconnect Facebook.",
        });
      }

      const all = await listListings();
      const listings = liveFacebookListings(all);
      const pending = pendingFacebookListings(all);
      const missingUrls = listingsMissingFacebookItemUrl(all);
      if (listings.length === 0 && pending.length === 0 && missingUrls.length === 0) {
        return status({
          last_tick_at: new Date().toISOString(),
          last_error: null,
          last_summary: "No live Facebook listings to watch yet.",
          scraped: 0,
        });
      }

      const result = await withLocalChrome("monitor", async () => {
        const page = await gotoLocalPage(
          "Facebook Marketplace",
          "https://www.facebook.com/marketplace",
          { focus: false, headless: true }
        );
        if (!(await facebookSignedIn(page))) {
          throw new Error("Facebook signed out. Connect Facebook again.");
        }

        const selling = await scanSellingPage(page);
        let removed = 0;
        let captured = 0;
        for (const listing of pending) {
          if (await markFacebookListingLive(listing, selling)) captured += 1;
          else if (await noteSellingPresence(listing, selling)) removed += 1;
        }
        const stillLive: Listing[] = [];
        for (const listing of listings) {
          const gone = await noteSellingPresence(listing, selling);
          if (gone) removed += 1;
          else stillLive.push(listing);
        }
        captured += await captureMissingFacebookItemUrls(
          page,
          await listListings(),
          selling
        );
        if (captured) {
          for (const listing of liveFacebookListings(await listListings())) {
            if (!stillLive.some((row) => row.id === listing.id)) stillLive.push(listing);
          }
        }

        let threads: InboxThread[] = [];
        try {
          if (stillLive.length) {
            await assertFacebookChatUnlocked(page);
            threads = (await openMarketplaceInbox(page)).filter(
              (thread) => looksLikePersonName(thread.buyer) && !isInboxChromeBuyer(thread.buyer)
            );
            if (stillLive[0]) {
              await logAgent(
                stillLive[0].id,
                "browser",
                "WATCH",
                threads.length
                  ? `Found ${threads.length} Marketplace buyer thread${threads.length === 1 ? "" : "s"}.`
                  : "Opened Marketplace inbox and notifications. No buyer threads this pass."
              );
            }
          }
        } catch {
          threads = [];
        }
        let replied = 0;
        let escalated = 0;
        for (const thread of threads.slice(0, 20)) {
          try {
            const outcome = await handleThread(page, thread, stillLive);
            replied += outcome.replied;
            escalated += outcome.escalated;
          } catch {
            /* keep watching the rest of the inbox */
          }
        }
        return { threads: threads.length, replied, escalated, removed, captured };
      });

      const summary = result.captured
        ? `Captured ${result.captured} Facebook listing${
            result.captured === 1 ? "" : "s"
          } from Selling after publish.`
        : result.removed
        ? `Facebook no longer has ${result.removed} listing${
            result.removed === 1 ? "" : "s"
          }. Sold marked ${result.removed === 1 ? "it" : "them"} gone.`
        : result.threads === 0
          ? "Opened Marketplace inbox. No buyer threads found this pass."
          : `Read ${result.threads} thread${result.threads === 1 ? "" : "s"}. ${
              result.replied
                ? `Replied to ${result.replied}.`
                : result.escalated
                  ? `Flagged ${result.escalated} for you.`
                  : "No new buyer messages."
            }`;

      return status({
        last_tick_at: new Date().toISOString(),
        last_error: null,
        last_summary: summary,
        scraped: result.threads,
        replied: result.replied,
        escalated: result.escalated,
        removed: result.removed,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Facebook watch failed.";
      return status({
        last_tick_at: new Date().toISOString(),
        last_error: message,
        last_summary: message,
      });
    } finally {
      memory.soldFbTick = null;
    }
  })();
  memory.soldFbTick = run;
  return run;
}

export function facebookMonitorStatus() {
  return status();
}

export async function capturePendingFacebookListings() {
  const pending = pendingFacebookListings(await listListings());
  return withLocalChrome("monitor", async () => {
    const page = await gotoLocalPage(
      "Facebook Marketplace",
      "https://www.facebook.com/marketplace/you/selling",
      { focus: false, headless: true }
    );
    if (!(await facebookSignedIn(page))) {
      throw new Error("Facebook signed out. Connect Facebook again.");
    }
    const selling = await scanSellingPage(page);
    const captured: string[] = [];
    for (const listing of pending) {
      if (await markFacebookListingLive(listing, selling)) captured.push(listing.title);
      else await noteSellingPresence(listing, selling);
    }
    const missing = listingsMissingFacebookItemUrl(await listListings());
    if (await captureMissingFacebookItemUrls(page, missing, selling)) {
      for (const listing of missing) captured.push(listing.title);
    }
    return {
      pending: [...pending, ...missing].map((listing) => listing.title),
      captured,
      cards: selling.cards.map((card) => card.text.slice(0, 80)),
      empty: selling.empty,
      loaded: selling.loaded,
      body: (selling.body || "").slice(0, 400),
    };
  });
}

export async function peekFacebookInbox() {
  const connection = await getPlatformConnection(
    DEMO_USER.id,
    "Facebook Marketplace"
  );
  if (!connection || connection.status !== "connected") {
    return { error: "Facebook is not connected.", threads: [], latest: null };
  }
  if (!isLocalConnection(connection.metadata)) {
    return {
      error: "Facebook inbox peek uses your Chrome profile.",
      threads: [],
      latest: null,
    };
  }

  return withLocalChrome("monitor", async () => {
    const page = await gotoLocalPage(
      "Facebook Marketplace",
      "https://www.facebook.com/marketplace",
      { focus: false, headless: true }
    );
    if (!(await facebookSignedIn(page))) {
      throw new Error("Facebook signed out. Connect Facebook again.");
    }
    await assertFacebookChatUnlocked(page);
    const threads = (await openMarketplaceInbox(page)).filter(
      (thread) => looksLikePersonName(thread.buyer) && !isInboxChromeBuyer(thread.buyer)
    );
    const top = threads[0] || null;
    let opened = false;
    let messages: { from: string; text: string }[] = [];
    if (top) {
      opened = await openInboxThread(page, top);
      if (opened) {
        messages = await readOpenThread(page);
      }
    }
    const last = messages.at(-1) || null;
    return {
      error: null,
      url: page.url(),
      threads: threads.slice(0, 8).map(summarizePeekThread),
      latest: top
        ? {
            buyer: top.buyer,
            listing_hint: top.hint,
            preview: top.preview,
            opened,
            last_from: last ? last.from : top.lastFrom,
            last_text: last ? last.text : top.preview,
          }
        : null,
    };
  });
}

function summarizePeekThread(thread: InboxThread) {
  return {
    buyer: thread.buyer,
    hint: thread.hint,
    preview: thread.preview,
    last_from: thread.lastFrom,
  };
}

async function captureMissingCraigslistUrl(page: Awaited<ReturnType<typeof gotoLocalPage>>, listing: Listing) {
  const missing = !listing.platform_posts.some(
    (post) =>
      post.platform === "Craigslist" &&
      post.status === "posted" &&
      /^https:\/\//.test(post.remote_url || "")
  );
  if (!listing.platforms.includes("Craigslist") || listing.status !== "live" || !missing) {
    return;
  }
  const found = await findCraigslistListingUrl(page, listing.title).catch(() => null);
  if (!found?.url) return;
  const latest = (await getListing(listing.id)) || listing;
  const post: PlatformPost = {
    platform: "Craigslist",
    status: "posted",
    via: "browserbase",
    url: livePath(listing.id, "Craigslist"),
    remote_url: found.url,
    remote_id: found.remoteId,
    remote_state: "live",
    checked_at: new Date().toISOString(),
    detail: "Live on Craigslist.",
  };
  const posts = upsertPlatformPosts(latest.platform_posts, [post]);
  await updateListing(listing.id, {
    platform_posts: posts,
    pipeline_stage: `Live · ${liveMarketplaceCount(posts)} marketplace${
      liveMarketplaceCount(posts) === 1 ? "" : "s"
    } posted`,
    pipeline_error: null,
  });
  await logAgent(
    listing.id,
    "browser",
    "LIVE",
    `Captured the public Craigslist URL for “${listing.title}”.`
  );
}

async function noteInboxWatch(listings: Listing[], detail: string) {
  const target = listings[0];
  if (!target) return;
  await logAgent(target.id, "browser", "WATCH", detail);
}

async function tickCraigslistInbox(): Promise<string | undefined> {
  const connection = await getPlatformConnection(DEMO_USER.id, "Craigslist");
  if (!connection || connection.status !== "connected") return;
  const all = await listListings();
  const listings = liveOnPlatform(all, "Craigslist");
  const missingLinks = all.filter(
    (listing) =>
      listing.status === "live" &&
      listing.platforms.includes("Craigslist") &&
      !listing.platform_posts.some(
        (post) =>
          post.platform === "Craigslist" &&
          post.status === "posted" &&
          /^https:\/\//.test(post.remote_url || "")
      )
  );
  if (listings.length === 0 && missingLinks.length === 0) return;
  const targets = listings.length ? listings : missingLinks;
  const adapter = getMarketplaceAdapter("Craigslist");
  const scan = async (page: Awaited<ReturnType<typeof gotoLocalPage>>) => {
    for (const listing of missingLinks) {
      await captureMissingCraigslistUrl(page, listing);
    }
    const threads = await scanCraigslistInbox(page);
    let stored = 0;
    for (const thread of threads) {
      const outcome = await recordMarketplaceInbound(listings, "Craigslist", thread);
      if (outcome !== "skipped") stored += 1;
    }
    const detail =
      threads.length === 0
        ? "Opened Craigslist messages. No buyer threads this pass."
        : stored
          ? `Read ${threads.length} Craigslist thread${threads.length === 1 ? "" : "s"}. Stored ${stored}.`
          : `Read ${threads.length} Craigslist thread${threads.length === 1 ? "" : "s"}. No new buyer messages.`;
    await noteInboxWatch(targets, detail);
    return detail;
  };
  const viaChrome = async () =>
    withLocalChrome("monitor", async () => {
      const page = await gotoLocalPage("Craigslist", adapter.loginUrl, {
        focus: false,
        headless: true,
      });
      return scan(page);
    });

  try {
    if (isLocalConnection(connection.metadata) || remoteMinutesExhausted()) {
      return await viaChrome();
    }
    if (!connection.context_id) return await viaChrome();
    const session = await startMarketplaceSession(
      connection.context_id,
      "Craigslist",
      "login",
      { live: false, timeoutMs: 18_000 }
    );
    try {
      return await scan(session.page);
    } finally {
      await releaseSession(session.sessionId).catch(() => undefined);
    }
  } catch (error) {
    if (isRemoteMinutesError(error)) markRemoteMinutesExhausted();
    try {
      return await viaChrome();
    } catch {
      memory.soldClWatchQuiet ??= 0;
      if (Date.now() - memory.soldClWatchQuiet > 30 * 60_000) {
        memory.soldClWatchQuiet = Date.now();
        await noteInboxWatch(
          targets,
          "Craigslist watch is using Chrome on this Mac. The remote browser is out of minutes."
        );
      }
      return;
    }
  }
}

async function tickEbayInbox(): Promise<string | undefined> {
  const connection = await getPlatformConnection(DEMO_USER.id, "eBay");
  if (!connection || connection.status !== "connected") return;
  if (!isLocalConnection(connection.metadata)) return;
  const listings = liveOnPlatform(await listListings(), "eBay");
  if (listings.length === 0) return;
  try {
    return await withLocalChrome("monitor", async () => {
      const page = await gotoLocalPage("eBay", "https://www.ebay.com/mesg/sly/overview", {
        focus: false,
        headless: true,
      });
      const threads = await scanEbayInbox(page);
      let stored = 0;
      for (const thread of threads) {
        const outcome = await recordMarketplaceInbound(listings, "eBay", thread);
        if (outcome !== "skipped") stored += 1;
      }
      const detail =
        threads.length === 0
          ? "Opened eBay messages. No buyer threads this pass."
          : stored
            ? `Read ${threads.length} eBay thread${threads.length === 1 ? "" : "s"}. Stored ${stored}.`
            : `Read ${threads.length} eBay thread${threads.length === 1 ? "" : "s"}. No new buyer messages.`;
      await noteInboxWatch(listings, detail);
      return detail;
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "eBay inbox watch failed.";
    await noteInboxWatch(listings, `eBay inbox watch failed: ${detail}`);
    return `eBay: ${detail}`;
  }
}

export async function tickAllInboxes(): Promise<FacebookMonitorStatus> {
  if (memory.soldInboxTick) return memory.soldInboxTick;
  const run = (async () => {
    try {
      const facebook = await getPlatformConnection(
        DEMO_USER.id,
        "Facebook Marketplace"
      );
      const listings = await listListings();
      const facebookWork =
        facebook?.status === "connected" &&
        isLocalConnection(facebook.metadata) &&
        (liveFacebookListings(listings).length > 0 ||
          pendingFacebookListings(listings).length > 0 ||
          listingsMissingFacebookItemUrl(listings).length > 0);
      const result = facebookWork
        ? await tickFacebookInbox()
        : status({
            last_tick_at: new Date().toISOString(),
            last_error: null,
            last_summary: "Watching connected inboxes. A chat appears only when a person writes you.",
          });
      await tickCraigslistInbox();
      await tickEbayInbox();
      return status({
        last_tick_at: result.last_tick_at || new Date().toISOString(),
        last_error: null,
        last_summary: "Watching Marketplace.",
        scraped: result.scraped,
        replied: result.replied,
        escalated: result.escalated,
        removed: result.removed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Inbox watch failed.";
      return status({
        last_tick_at: new Date().toISOString(),
        last_error: message,
        last_summary: message,
      });
    } finally {
      memory.soldInboxTick = null;
    }
  })();
  memory.soldInboxTick = run;
  return run;
}

export function startFacebookMonitor(options?: { immediate?: boolean }) {
  if (!memory.soldFbMonitor) {
    memory.soldFbMonitor = setInterval(() => {
      void tickAllInboxes();
    }, TICK_MS);
  }
  if (options?.immediate === false) {
    if (!memory.soldFbWarmup && !memory.soldFbTick && !memory.soldInboxTick) {
      memory.soldFbWarmup = setTimeout(() => {
        memory.soldFbWarmup = undefined;
        void tickAllInboxes();
      }, 15_000);
    }
    return status({
      last_summary:
        memory.soldFbStatus?.last_summary ||
        "Watching connected inboxes in the background.",
    });
  }
  if (memory.soldFbWarmup) {
    clearTimeout(memory.soldFbWarmup);
    memory.soldFbWarmup = undefined;
  }
  void tickAllInboxes();
  return status({
    last_summary: memory.soldFbStatus?.last_summary || "Watching connected inboxes.",
  });
}

export async function ensureBackgroundFacebookMonitor() {
  if (memory.soldFbMonitor) return facebookMonitorStatus();
  const listings = await listListings();
  const facebook = await getPlatformConnection(DEMO_USER.id, "Facebook Marketplace");
  const craigslist = await getPlatformConnection(DEMO_USER.id, "Craigslist");
  const ebay = await getPlatformConnection(DEMO_USER.id, "eBay");
  const facebookReady =
    facebook?.status === "connected" &&
    isLocalConnection(facebook.metadata) &&
    (liveFacebookListings(listings).length > 0 ||
      pendingFacebookListings(listings).length > 0 ||
      listingsMissingFacebookItemUrl(listings).length > 0);
  const craigslistReady =
    craigslist?.status === "connected" &&
    (liveOnPlatform(listings, "Craigslist").length > 0 ||
      listings.some(
        (listing) =>
          listing.status === "live" &&
          listing.platforms.includes("Craigslist") &&
          !listing.platform_posts.some(
            (post) =>
              post.platform === "Craigslist" &&
              post.status === "posted" &&
              /^https:\/\//.test(post.remote_url || "")
          )
      ));
  const ebayReady =
    ebay?.status === "connected" &&
    isLocalConnection(ebay.metadata) &&
    liveOnPlatform(listings, "eBay").length > 0;
  if (!facebookReady && !craigslistReady && !ebayReady) {
    return facebookMonitorStatus();
  }
  return startFacebookMonitor({ immediate: true });
}

export function stopFacebookMonitor() {
  if (memory.soldFbMonitor) {
    clearInterval(memory.soldFbMonitor);
    memory.soldFbMonitor = undefined;
  }
  if (memory.soldFbWarmup) {
    clearTimeout(memory.soldFbWarmup);
    memory.soldFbWarmup = undefined;
  }
  return status({ last_summary: "Stopped watching inboxes." });
}
