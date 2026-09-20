import assert from "node:assert/strict";
import test from "node:test";
import {
  alreadySeenInbound,
  facebookThreadId,
  marketplaceThreadId,
  parseInboxRow,
  parseMarketplaceNotice,
  lastBuyerText,
  matchListingToText,
  parseThreadPreview,
  resolveThreadListing,
  sellerTookOver,
  titleTokens,
  looksLikeBuyerThread,
  looksLikePersonName,
  isInboxChromeBuyer,
  isRealBuyerMessage,
  isThreadChrome,
  sellingPresence,
  classifySellingText,
} from "../src/lib/marketplace/facebook-inbox-match.ts";
import {
  facebookListingGone,
  facebookListingReview,
  hasLiveMarketplace,
  hasPostedMarketplace,
  hasVerifiedRemoteUrl,
  listingChatReady,
  listingPublishStalled,
  shouldSendLiveReceipt,
  unpublishedMarketplacePlatforms,
} from "../src/lib/marketplace/policy.ts";

test("tokenizes listing titles without filler words", () => {
  assert.deepEqual(titleTokens("Test navy blue gift box"), [
    "test",
    "navy",
    "blue",
    "gift",
    "box",
  ]);
});

test("matches a Marketplace thread to the live listing", () => {
  const listings = [
    { id: "a6ca2404", title: "Test navy blue gift box" },
    { id: "other", title: "Oasis water bottle" },
  ];
  const matched = matchListingToText(
    "Jordan · Test navy blue gift box · Is this still available?",
    listings
  );
  assert.equal(matched?.id, "a6ca2404");
  assert.equal(
    resolveThreadListing("Is this available?", [{ id: "only", title: "Gift box" }])?.id,
    "only"
  );
  assert.equal(resolveThreadListing("random chat", listings), null);
  assert.equal(
    looksLikeBuyerThread("You have a new friend suggestion: Triton Smith"),
    false
  );
  assert.equal(
    resolveThreadListing(
      "You have a new friend suggestion: Triton Smith",
      [{ id: "only", title: "Test navy blue gift box" }]
    ),
    null
  );
  assert.equal(looksLikePersonName("Facebook Marketplace Assistant"), false);
  assert.equal(looksLikePersonName("eBay"), false);
  assert.equal(looksLikePersonName("Craigslist"), false);
  assert.equal(looksLikePersonName("Priya Shah"), true);
  assert.equal(isThreadChrome("Block"), true);
  assert.equal(isRealBuyerMessage("Block"), false);
  assert.equal(isRealBuyerMessage("Sorry, it's not available."), false);
  assert.equal(isRealBuyerMessage("Still available?"), true);
  assert.equal(isRealBuyerMessage("Hi"), true);
  assert.equal(isRealBuyerMessage("Toronto, ON"), false);
  assert.equal(looksLikePersonName("MarketplaceUnread message:18 new messages · 1m"), false);
  assert.equal(looksLikePersonName("Seller dashboard"), false);
  assert.equal(looksLikeBuyerThread("MarketplaceUnread message:18 new messages · 1m"), false);
  assert.equal(isInboxChromeBuyer("MarketplaceUnread message:18 new messages · 1m"), true);
  assert.equal(
    resolveThreadListing("https://www.facebook.com/marketplace/item/1444979087522068 Hi", [
      {
        id: "gift",
        title: "Test navy blue gift box",
        platform_posts: [
          {
            platform: "Facebook Marketplace",
            remote_url: "https://www.facebook.com/marketplace/item/1071909965819395",
          },
        ],
      },
      {
        id: "laptop",
        title: "Silver Laptop with Backlit Keyboard and Large Trackpad",
        platform_posts: [
          {
            platform: "Facebook Marketplace",
            remote_url: "https://www.facebook.com/marketplace/item/1444979087522068",
          },
        ],
      },
    ])?.id,
    "laptop"
  );
});

test("builds a stable Facebook conversation id", () => {
  assert.equal(
    facebookThreadId("Jordan Chen", "a6ca2404"),
    "fb:a6ca2404:jordan-chen"
  );
  assert.equal(
    marketplaceThreadId("Craigslist", "a6ca2404", "Priya Shah"),
    "cl:a6ca2404:priya-shah"
  );
  assert.equal(
    marketplaceThreadId("eBay", "a6ca2404", "Priya Shah"),
    "ebay:a6ca2404:priya-shah"
  );
});

test("parses a Marketplace phone notification", () => {
  const notice = parseMarketplaceNotice(
    "Priya Shah sent you a message about Silver Laptop with Backlit Keyboard · 2m"
  );
  assert.equal(notice?.buyer, "Priya Shah");
  assert.match(notice?.hint || "", /laptop/i);
  assert.equal(parseMarketplaceNotice("Triton Smith accepted your friend request"), null);
  const prefixed = parseMarketplaceNotice(
    "Marketplace · Priya Shah is interested in your listing Silver Laptop"
  );
  assert.equal(prefixed?.buyer, "Priya Shah");
  assert.match(prefixed?.hint || "", /laptop/i);
});

test("parses a real marketplace inbox row and skips chrome", () => {
  const row = parseInboxRow("Priya Shah Re: OASIS Apple Juice still available?");
  assert.equal(row?.buyer, "Priya Shah");
  assert.match(row?.preview || "", /still available/i);
  assert.equal(parseInboxRow("eBay Member Shipping update for your order"), null);
});

test("parses inbox preview cells", () => {
  const parsed = parseThreadPreview(
    "Jordan Chen\nTest navy blue gift box\nIs this available?\n2m"
  );
  assert.equal(parsed.buyer, "Jordan Chen");
  assert.match(parsed.hint, /gift box/i);
  assert.match(parsed.preview, /available/i);
});

test("does not renegotiate a buyer line Sold already stored", () => {
  const history = [
    { sender: "buyer" as const, text: "Is this available?" },
    { sender: "agent" as const, text: "Yes, still available." },
  ];
  assert.equal(alreadySeenInbound(history, "Is this available?"), true);
  assert.equal(alreadySeenInbound(history, "Can you do $8?"), false);
  assert.equal(sellerTookOver([...history, { sender: "human" as const }]), true);
});

test("treats a missing Selling card as gone, not a leftover page word", () => {
  const listing = { id: "a6ca2404", title: "Test navy blue gift box" };
  assert.equal(classifySellingText("In review · CA$12"), "review");
  assert.equal(classifySellingText("This listing was deleted"), "deleted");
  assert.equal(
    sellingPresence(listing, {
      loaded: true,
      empty: true,
      cards: [],
    }),
    "missing"
  );
  assert.equal(
    sellingPresence(listing, {
      loaded: true,
      empty: false,
      cards: [
        {
          text: "This listing was deleted · Test navy blue gift box",
          href: "",
          state: "deleted",
        },
      ],
    }),
    "deleted"
  );
  assert.equal(
    sellingPresence(listing, {
      loaded: true,
      empty: false,
      cards: [{ text: "Still listed · price drop on another item", href: "", state: "active" }],
    }),
    "missing"
  );
  assert.equal(
    sellingPresence(listing, {
      loaded: true,
      empty: false,
      cards: [],
      body: "In review · Test navy blue gift box · CA$12",
    }),
    "review"
  );
  assert.equal(
    facebookListingGone({
      platform_posts: [
        {
          platform: "Facebook Marketplace",
          status: "needs_attention",
          via: "browserbase",
          detail: "Gone from Facebook Marketplace. It looks deleted or taken down.",
        },
      ],
    }),
    true
  );
  assert.equal(
    listingChatReady({
      status: "live",
      platform_posts: [
        {
          platform: "Facebook Marketplace",
          status: "needs_attention",
          via: "browserbase",
          detail: "Gone from Facebook Marketplace. It looks deleted or taken down.",
        },
      ],
    }),
    true
  );
});

test("Facebook in-review is captured but not treated as live", () => {
  const review = {
    status: "posting" as const,
    platforms: ["Facebook Marketplace"] as const,
    platform_posts: [
      {
        platform: "Facebook Marketplace" as const,
        status: "posted" as const,
        via: "browserbase" as const,
        remote_url: "https://www.facebook.com/marketplace/you/selling",
        remote_state: "review" as const,
        detail: "Submitted to Facebook. Facebook is reviewing it — not publicly live yet.",
      },
    ],
  };
  assert.equal(hasPostedMarketplace(review), true);
  assert.equal(hasLiveMarketplace(review), false);
  assert.equal(facebookListingReview(review), true);
  assert.equal(listingChatReady(review), false);
  assert.equal(listingPublishStalled(review), false);
  assert.equal(shouldSendLiveReceipt(review.platform_posts), false);
  assert.equal(hasVerifiedRemoteUrl(review.platform_posts[0]), false);
  assert.deepEqual(unpublishedMarketplacePlatforms(review), []);
  assert.equal(
    listingChatReady({
      status: "live",
      platform_posts: [
        {
          platform: "Facebook Marketplace",
          status: "posted",
          via: "browserbase",
          remote_url: "https://www.facebook.com/marketplace/item/99",
          remote_state: "live",
        },
      ],
    }),
    true
  );
});

test("reads the latest buyer bubble", () => {
  assert.equal(
    lastBuyerText([
      { from: "buyer", text: "Hi" },
      { from: "seller", text: "Yes still available" },
      { from: "buyer", text: "Would you take $8?" },
    ]),
    "Would you take $8?"
  );
});
