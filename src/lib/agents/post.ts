import type { Listing, Platform, PlatformPost } from "../types";
import { decoratePosts, livePath } from "../platforms";
import { getPlatformConnection, upsertPlatformConnection } from "../db";
import { DEMO_USER } from "../types";
import {
  captureFacebookListing,
  findCraigslistListingUrl,
  getMarketplaceAdapter,
} from "../marketplace/adapters";
import {
  releaseSession,
  remoteMinutesExhausted,
  resumeMarketplaceSession,
  sessionLiveUrl,
  startMarketplaceSession,
} from "../marketplace/browserbase";
import { isLocalConnection, localPage, withLocalChrome } from "../marketplace/local-browser";
import { shouldSendLiveReceipt } from "../marketplace/policy";
import { browserbaseRetryDelay } from "../marketplace/rate-limit";

function postedFromCapture(
  listing: Listing,
  platform: Platform,
  captured: { url: string; remoteId?: string; state?: "active" | "review" }
): PlatformPost {
  const review = platform === "Facebook Marketplace" && captured.state === "review";
  return {
    platform,
    status: "posted",
    via: "browserbase",
    url: livePath(listing.id, platform),
    remote_url: captured.url,
    remote_id: captured.remoteId,
    remote_state: review ? "review" : "live",
    checked_at: new Date().toISOString(),
    detail: review
      ? "Submitted to Facebook. Facebook is reviewing it — not publicly live yet."
      : `Live on ${platform}.`,
  };
}

export async function postListing(listing: Listing): Promise<PlatformPost[]> {
  const posts: PlatformPost[] = [];

  for (const platform of listing.platforms) {
    const existing = listing.platform_posts.find(
      (post) => post.platform === platform && post.status === "posted"
    );
    if (existing) {
      posts.push(existing);
      continue;
    }
    const connection = await getPlatformConnection(DEMO_USER.id, platform);
    if (connection?.status !== "connected" || !connection.context_id) {
      posts.push({
        platform,
        status: "failed",
        via: "browserbase",
        url: livePath(listing.id, platform),
        detail: `Did not go live on ${platform}. Connect and verify the account, then try again.`,
      });
      continue;
    }

    if (isLocalConnection(connection.metadata) || platform === "eBay" || remoteMinutesExhausted()) {
      posts.push(await postViaLocalChrome(listing, platform));
      continue;
    }

    let sessionId: string | null = null;
    try {
      let session: Awaited<ReturnType<typeof startMarketplaceSession>> | null =
        null;
      if (connection.session_id) {
        session = await resumeMarketplaceSession(connection.session_id).catch(
          () => null
        );
      }
      if (!session) {
        session = await startMarketplaceSession(
          connection.context_id,
          platform,
          "posting"
        );
      }
      sessionId = session.sessionId;
      await upsertPlatformConnection({
        ...connection,
        session_id: sessionId,
        updated_at: new Date().toISOString(),
      });
      const liveUrl = async () =>
        sessionId ? sessionLiveUrl(sessionId).catch(() => null) : null;
      const adapter = getMarketplaceAdapter(platform);
      await session.page.goto(adapter.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const login = await adapter.detectLogin(session.page);
      if (!login.loggedIn) {
        if (platform === "Craigslist") {
          posts.push(await postViaLocalChrome(listing, platform));
          continue;
        }
        posts.push({
          platform,
          status: "failed",
          via: "browserbase",
          url: livePath(listing.id, platform),
          session_url: (await liveUrl()) || undefined,
          detail: `Did not go live on ${platform}. The saved login expired.`,
        });
        continue;
      }
      const filled = await adapter.fill(session.page, listing);
      const grabRemote = async () =>
        platform === "Craigslist"
          ? findCraigslistListingUrl(session.page, listing.title).catch(() => null)
          : adapter.verify(session.page);
      let verified =
        /live listing opened|published at/i.test(filled.detail)
          ? await grabRemote()
          : null;
      if (!verified && filled.readyToPublish) {
        await adapter.publish(session.page).catch(() => undefined);
        for (let attempt = 0; attempt < 4 && !verified; attempt += 1) {
          verified = await grabRemote();
          if (!verified) await session.page.waitForTimeout(2_000);
        }
      }
      if (!verified) {
        if (platform === "Craigslist") {
          posts.push(await postViaLocalChrome(listing, platform));
          continue;
        }
        posts.push({
          platform,
          status: "failed",
          via: "browserbase",
          url: livePath(listing.id, platform),
          session_url: (await liveUrl()) || undefined,
          detail: `Did not go live on ${platform}. ${filled.detail || "Publish ran, but no live listing URL was verified."}`,
        });
        continue;
      }
      posts.push(postedFromCapture(listing, platform, verified));
      await releaseSession(sessionId);
      await upsertPlatformConnection({
        ...connection,
        session_id: null,
        updated_at: new Date().toISOString(),
      });
      sessionId = null;
    } catch (error) {
      if (platform === "Craigslist") {
        posts.push(await postViaLocalChrome(listing, platform));
        continue;
      }
      const limited = browserbaseRetryDelay(error) != null;
      posts.push({
        platform,
        status: "failed",
        via: "browserbase",
        url: livePath(listing.id, platform),
        detail: limited
          ? `Did not go live on ${platform}. Browserbase rate-limited the browser session; wait about a minute and try publishing again.`
          : error instanceof Error
            ? `Did not go live on ${platform}. ${error.message}`
            : `Did not go live on ${platform}.`,
      });
    }
  }

  if (shouldSendLiveReceipt(posts)) {
    const receipt = await sendLiveReceipt(listing, posts);
    if (receipt) posts.unshift(receipt);
  }

  return decoratePosts(listing.id, listing.title, posts);
}

async function postViaLocalChrome(
  listing: Listing,
  platform: Platform
): Promise<PlatformPost> {
  return withLocalChrome("post", async () => {
  try {
  const adapter = getMarketplaceAdapter(platform);
  const page = await localPage(platform, adapter.loginUrl);
  let login = await adapter.detectLogin(page);
  if (!login.loggedIn && (platform === "Craigslist" || platform === "eBay")) {
    const started = Date.now();
    while (Date.now() - started < 180_000) {
      login = await adapter.detectLogin(page);
      if (login.loggedIn) break;
      await page.waitForTimeout(2_500);
    }
  }
  if (!login.loggedIn) {
    return {
      platform,
      status: "failed",
      via: "browserbase",
      url: livePath(listing.id, platform),
      detail: `Did not go live on ${platform}. Connect the account again, then try publishing.`,
    };
  }
  const filled = await adapter.fill(page, listing);
  const grab = async () =>
    platform === "Facebook Marketplace"
      ? captureFacebookListing(page, listing.title).catch(() => null)
      : platform === "Craigslist"
        ? findCraigslistListingUrl(page, listing.title).catch(() => null)
        : adapter.verify(page).catch(() => null);

  let captured = /live listing opened|published at/i.test(filled.detail)
    ? await grab()
    : null;
  if (captured) return postedFromCapture(listing, platform, captured);
  if (!filled.readyToPublish) {
    captured = await grab();
    if (!captured) {
      return {
        platform,
        status: "failed",
        via: "browserbase",
        url: livePath(listing.id, platform),
        detail: `Did not go live on ${platform}. ${filled.detail}`,
      };
    }
    return postedFromCapture(listing, platform, captured);
  }
  await adapter.publish(page).catch(() => undefined);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    captured = await grab();
    if (captured) return postedFromCapture(listing, platform, captured);
    await page.waitForTimeout(2_000);
  }
  return {
    platform,
    status: "failed",
    via: "browserbase",
    url: livePath(listing.id, platform),
    detail: `Did not go live on ${platform}. Publish ran, but no live listing URL was verified.`,
  };
  } catch (error) {
    const recovered =
      platform === "Facebook Marketplace"
        ? await captureFacebookListing(
            await localPage(platform, "https://www.facebook.com/marketplace/you/selling"),
            listing.title
          ).catch(() => null)
        : platform === "Craigslist"
          ? await findCraigslistListingUrl(
              await localPage(platform, "https://accounts.craigslist.org/login/home"),
              listing.title
            ).catch(() => null)
          : null;
    if (recovered) return postedFromCapture(listing, platform, recovered);
    return {
      platform,
      status: "failed",
      via: "browserbase",
      url: livePath(listing.id, platform),
      detail:
        error instanceof Error
          ? `Did not go live on ${platform}. ${error.message}`
          : `Did not go live on ${platform}.`,
    };
  }
  });
}

async function sendLiveReceipt(
  listing: Listing,
  posts: PlatformPost[]
): Promise<PlatformPost | null> {
  const existing = listing.platform_posts.find(
    (post) => post.platform === "Gmail receipt" && post.status === "posted"
  );
  if (existing) return existing;

  const apiKey = process.env.COMPOSIO_API_KEY;
  const to = process.env.COMPOSIO_NOTIFY_EMAIL;
  const userId = process.env.COMPOSIO_USER_ID || "sold-demo";
  if (!apiKey || !to) return null;

  const liveLinks = posts
    .filter((post) => post.platform !== "Gmail receipt" && post.status === "posted")
    .map((post) => `${post.platform}: ${post.remote_url || post.url || ""}`)
    .join("\n");

  try {
    const { Composio } = await import("@composio/core");
    const composio = new Composio({ apiKey });
    await composio.tools.execute("GMAIL_SEND_EMAIL", {
      userId,
      arguments: {
        recipient_email: to,
        subject: `Sold listing is live: ${listing.title} — $${listing.price}`,
        body: [
          `${listing.title}`,
          `Price: $${listing.price}`,
          "",
          listing.description,
          "",
          "Live listings:",
          liveLinks || "Verified marketplace URL is in Sold.",
        ].join("\n"),
      },
      dangerouslySkipVersionCheck: true,
    });
    return {
      platform: "Gmail receipt",
      status: "posted",
      via: "composio",
      url: livePath(listing.id, "Gmail receipt"),
      remote_url: "https://mail.google.com",
      detail: `Live receipt emailed to ${to}.`,
    };
  } catch {
    return null;
  }
}
