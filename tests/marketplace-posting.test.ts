import assert from "node:assert/strict";
import test from "node:test";
import { decoratePosts, platformSlug } from "../src/lib/platforms.ts";
import { getMarketplaceAdapter } from "../src/lib/marketplace/adapters.ts";
import {
  formatPlatformList,
  hasPostedMarketplace,
  hasVerifiedRemoteUrl,
  listingAwaitingPublish,
  listingChatReady,
  listingPublishStalled,
  missingConnectedPlatforms,
  shouldSendLiveReceipt,
  statusFromLoginEvidence,
  summarizePostingResults,
  unpublishedMarketplacePlatforms,
} from "../src/lib/marketplace/policy.ts";
import type { PlatformPost } from "../src/lib/types.ts";

test("maps login evidence without treating a context as authentication", () => {
  assert.equal(statusFromLoginEvidence(false, false), "not_connected");
  assert.equal(statusFromLoginEvidence(false, true), "awaiting_login");
  assert.equal(statusFromLoginEvidence(true, true), "connected");
});

test("selects a fixed adapter for every supported marketplace", () => {
  assert.equal(getMarketplaceAdapter("Facebook Marketplace").domains[0], "facebook.com");
  assert.equal(getMarketplaceAdapter("Kijiji").domains[0], "kijiji.ca");
  assert.equal(getMarketplaceAdapter("OfferUp").domains[0], "offerup.com");
  assert.equal(getMarketplaceAdapter("Craigslist").domains[0], "craigslist.org");
  assert.equal(getMarketplaceAdapter("Mercari").domains[0], "mercari.com");
  assert.equal(getMarketplaceAdapter("Poshmark").domains[0], "poshmark.com");
  assert.equal(getMarketplaceAdapter("eBay").domains[0], "ebay.com");
  assert.equal(platformSlug("Facebook Marketplace"), "facebook");
  assert.equal(platformSlug("Kijiji"), "kijiji");
  assert.match(platformSlug("Facebook Marketplace"), /^[\w\-_,;:.()&$%#@!?~]+$/);
});

test("summarizes independent platform outcomes", () => {
  const posts: PlatformPost[] = [
    { platform: "eBay", status: "posted", via: "browserbase", remote_url: "https://www.ebay.com/itm/12345" },
    { platform: "Craigslist", status: "failed", via: "browserbase" },
    { platform: "Craigslist", status: "needs_attention", via: "browserbase" },
    { platform: "Facebook Marketplace", status: "connection_required", via: "browserbase" },
  ];
  assert.deepEqual(summarizePostingResults(posts), {
    posted: 1,
    connectionRequired: 1,
    needsAttention: 1,
    failed: 1,
  });
});

test("blocks approval when a selected platform is not connected", () => {
  assert.deepEqual(
    missingConnectedPlatforms(
      ["Facebook Marketplace", "Craigslist"],
      { "Facebook Marketplace": "connected" }
    ),
    ["Craigslist"]
  );
  assert.deepEqual(
    missingConnectedPlatforms(["eBay"], { eBay: "connected" }),
    []
  );
  assert.equal(
    formatPlatformList(["Facebook Marketplace", "Craigslist"]),
    "Facebook Marketplace and Craigslist"
  );
});

test("chat stays closed until a marketplace actually posts", () => {
  const unpublished = {
    status: "live",
    platforms: ["Craigslist"] as const,
    platform_posts: [
      {
        platform: "Craigslist" as const,
        status: "needs_attention" as const,
        via: "browserbase" as const,
      },
      {
        platform: "Gmail receipt" as const,
        status: "posted" as const,
        via: "composio" as const,
      },
    ],
  };
  assert.equal(listingChatReady(unpublished), false);
  assert.equal(listingPublishStalled(unpublished), true);
  assert.equal(
    listingPublishStalled({
      status: "posting",
      platforms: ["Facebook Marketplace", "Craigslist"],
      platform_posts: [
        {
          platform: "Facebook Marketplace" as const,
          status: "posted" as const,
          via: "browserbase" as const,
          remote_url: "https://www.facebook.com/marketplace/item/1",
        },
      ],
    }),
    false
  );
  assert.equal(hasPostedMarketplace(unpublished), false);
  assert.equal(
    listingChatReady({
      status: "live",
      platform_posts: [
        {
          platform: "Craigslist",
          status: "posted",
          via: "browserbase",
          remote_url: "https://newyork.craigslist.org/d/juice/123.html",
        },
      ],
    }),
    true
  );
});

test("live listings with unpublished platforms still need a publish action", () => {
  assert.equal(
    listingAwaitingPublish({
      status: "live",
      platforms: ["eBay"],
      platform_posts: [
        {
          platform: "eBay",
          status: "connection_required",
          via: "browserbase",
        },
      ],
    }),
    true
  );
  assert.equal(
    listingAwaitingPublish({
      status: "ready",
      platforms: ["eBay"],
      platform_posts: [],
    }),
    false
  );
  assert.deepEqual(
    unpublishedMarketplacePlatforms({
      platforms: ["eBay", "Craigslist"],
      platform_posts: [
        {
          platform: "eBay",
          status: "posted",
          via: "browserbase",
          remote_url: "https://www.ebay.com/itm/1",
        },
      ],
    }),
    ["Craigslist"]
  );
});

test("email receipt is only for verified live marketplace posts", () => {
  assert.equal(
    shouldSendLiveReceipt([
      {
        platform: "Gmail receipt",
        status: "posted",
        via: "composio",
      },
      {
        platform: "Craigslist",
        status: "failed",
        via: "browserbase",
      },
    ]),
    false
  );
  assert.equal(
    shouldSendLiveReceipt([
      {
        platform: "Craigslist",
        status: "posted",
        via: "browserbase",
        remote_url: "https://newyork.craigslist.org/d/juice/123.html",
      },
    ]),
    true
  );
});

test("waits out Browserbase burst rate limits", async () => {
  const { browserbaseRetryDelay, existingContextId } = await import(
    "../src/lib/marketplace/rate-limit.ts"
  );
  assert.equal(
    browserbaseRetryDelay(
      new Error(
        "429 You've exceeded your burst rate limit (5 requests per 1 minute). You can try again in 45 seconds."
      )
    ),
    47_000
  );
  assert.equal(browserbaseRetryDelay(new Error("429 rate limit")), 47_000);
  assert.equal(browserbaseRetryDelay(new Error("Navigation timeout")), null);
  assert.equal(
    existingContextId(
      Object.assign(new Error("409 A context with this name already exists in the project"), {
        status: 409,
        error: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      })
    ),
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  );
  assert.equal(
    existingContextId(
      new Error("409 A context with this name already exists in the project")
    ),
    null
  );
});

test("never decorates marketplace posts with fabricated remote URLs", () => {
  const [post] = decoratePosts("listing-1", "Chair", [
    { platform: "eBay", status: "connection_required", via: "browserbase" },
  ]);
  assert.equal(post.remote_url, undefined);
  assert.equal(hasVerifiedRemoteUrl(post), false);
  assert.match(post.url || "", /^\/live\/listing-1\/ebay$/);
});
