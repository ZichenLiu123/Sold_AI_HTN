import type {
  Platform,
  PlatformConnectionStatus,
  PlatformPost,
} from "../types";

export function statusFromLoginEvidence(
  loggedIn: boolean,
  hasContext: boolean
): PlatformConnectionStatus {
  if (!hasContext) return "not_connected";
  return loggedIn ? "connected" : "awaiting_login";
}

export function summarizePostingResults(posts: PlatformPost[]) {
  const marketplace = posts.filter((post) => post.platform !== "Gmail receipt");
  return {
    posted: marketplace.filter((post) => post.status === "posted").length,
    connectionRequired: marketplace.filter(
      (post) => post.status === "connection_required"
    ).length,
    needsAttention: marketplace.filter((post) =>
      ["needs_attention", "awaiting_user"].includes(post.status)
    ).length,
    failed: marketplace.filter((post) => post.status === "failed").length,
  };
}

export function isMarketplaceReview(post: PlatformPost) {
  if (post.status !== "posted") return false;
  if (post.remote_state === "review") return true;
  if (post.remote_state === "live") return false;
  return /in review|being reviewed|not publicly live/i.test(post.detail || "");
}

export function isMarketplaceLive(post: PlatformPost) {
  if (post.platform === "Gmail receipt") return false;
  if (post.status !== "posted") return false;
  if (isMarketplaceReview(post)) return false;
  return true;
}

export function hasVerifiedRemoteUrl(post: PlatformPost) {
  if (!isMarketplaceLive(post)) return false;
  const url = post.remote_url || "";
  if (!/^https:\/\//.test(url)) return false;
  if (post.platform === "Facebook Marketplace") {
    return /facebook\.com\/marketplace\/item\/\d+/i.test(url);
  }
  if (/facebook\.com\/marketplace\/you/i.test(url)) return false;
  return true;
}

export function facebookListingReview(listing: {
  platform_posts: PlatformPost[];
}): boolean {
  return marketplacePosts(listing.platform_posts).some(
    (post) => post.platform === "Facebook Marketplace" && isMarketplaceReview(post)
  );
}

export function missingConnectedPlatforms(
  platforms: Platform[],
  statusByPlatform: Partial<Record<Platform, PlatformConnectionStatus>>
): Platform[] {
  return platforms.filter(
    (platform) => statusByPlatform[platform] !== "connected"
  );
}

export function unpublishedMarketplacePlatforms(listing: {
  platforms: readonly Platform[];
  platform_posts: PlatformPost[];
}): Platform[] {
  return listing.platforms.filter((platform) => {
    const post = listing.platform_posts.find((row) => row.platform === platform);
    return !post || post.status !== "posted";
  });
}

export function marketplacePosts(posts: PlatformPost[]): PlatformPost[] {
  return posts.filter((post) => post.platform !== "Gmail receipt");
}

export function upsertPlatformPosts(
  existing: PlatformPost[],
  incoming: PlatformPost[]
): PlatformPost[] {
  const byPlatform = new Map(existing.map((post) => [post.platform, post]));
  for (const post of incoming) byPlatform.set(post.platform, post);
  return [...byPlatform.values()];
}

export function liveMarketplaceCount(posts: PlatformPost[]) {
  return marketplacePosts(posts).filter(isMarketplaceLive).length;
}

export function hasPostedMarketplace(listing: {
  platform_posts: PlatformPost[];
}): boolean {
  return marketplacePosts(listing.platform_posts).some(
    (post) => post.status === "posted"
  );
}

export function hasLiveMarketplace(listing: {
  platform_posts: PlatformPost[];
}): boolean {
  return marketplacePosts(listing.platform_posts).some(isMarketplaceLive);
}

/** Receipt email goes out only after a marketplace listing is verified live. */
export function shouldSendLiveReceipt(posts: PlatformPost[]): boolean {
  return hasLiveMarketplace({ platform_posts: posts });
}

export function facebookListingGone(listing: {
  platform_posts: PlatformPost[];
}): boolean {
  return marketplacePosts(listing.platform_posts).some(
    (post) =>
      post.platform === "Facebook Marketplace" &&
      (post.status === "needs_attention" || post.status === "failed") &&
      /gone from facebook|no longer|deleted|taken down/i.test(post.detail || "")
  );
}

export function listingChatReady(listing: {
  status: string;
  platform_posts: PlatformPost[];
}): boolean {
  if (listing.status === "sold") return true;
  if (listing.status !== "live") return false;
  if (facebookListingGone(listing)) return true;
  return hasLiveMarketplace(listing);
}

export function listingPublishStalled(listing: {
  status: string;
  platforms?: readonly Platform[];
  platform_posts: PlatformPost[];
}): boolean {
  if (listingChatReady(listing)) return false;
  if (facebookListingReview(listing) && unpublishedMarketplacePlatforms({
    platforms: listing.platforms || [],
    platform_posts: listing.platform_posts,
  }).length === 0) {
    return false;
  }
  if (
    listing.status !== "live" &&
    listing.status !== "posting" &&
    listing.status !== "error"
  ) {
    return false;
  }
  return marketplacePosts(listing.platform_posts).length > 0;
}

export function listingAwaitingPublish(listing: {
  status: string;
  platforms: Platform[];
  platform_posts: PlatformPost[];
}): boolean {
  if (listing.status !== "live" && listing.status !== "posting") return false;
  return unpublishedMarketplacePlatforms(listing).length > 0;
}

export function formatPlatformList(platforms: Platform[]): string {
  if (platforms.length === 0) return "";
  if (platforms.length === 1) return platforms[0];
  if (platforms.length === 2) return `${platforms[0]} and ${platforms[1]}`;
  return `${platforms.slice(0, -1).join(", ")}, and ${platforms.at(-1)}`;
}
