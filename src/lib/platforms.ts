import type { Listing, Platform, PlatformPost } from "./types";

export const PLATFORM_SLUGS: Record<string, string> = {
  "Facebook Marketplace": "facebook",
  Kijiji: "kijiji",
  OfferUp: "offerup",
  Craigslist: "craigslist",
  Mercari: "mercari",
  Poshmark: "poshmark",
  eBay: "ebay",
  "Gmail receipt": "gmail",
};

const SLUG_TO_PLATFORM: Record<string, Platform | "Gmail receipt"> = {
  facebook: "Facebook Marketplace",
  kijiji: "Kijiji",
  offerup: "OfferUp",
  craigslist: "Craigslist",
  mercari: "Mercari",
  poshmark: "Poshmark",
  ebay: "eBay",
  gmail: "Gmail receipt",
};

export function platformSlug(platform: string): string {
  return PLATFORM_SLUGS[platform] || platform.toLowerCase().replace(/\s+/g, "-");
}

export function platformFromSlug(
  slug: string
): Platform | "Gmail receipt" | null {
  return SLUG_TO_PLATFORM[slug] || null;
}

export function livePath(listingId: string, platform: string): string {
  return `/live/${listingId}/${platformSlug(platform)}`;
}

export function isPublicItemUrl(platform: string, url?: string | null) {
  if (!url) return false;
  switch (platform) {
    case "Facebook Marketplace":
      return /facebook\.com\/marketplace\/item\/\d+/i.test(url);
    case "Kijiji":
      return /kijiji\.ca\/.+/i.test(url) && /\/\d{6,}/.test(url);
    case "OfferUp":
      return /offerup\.com\/item\//i.test(url);
    case "Craigslist":
      return /craigslist\.org\/.+\/d\/.+\/\d+\.html/i.test(url);
    case "Mercari":
      return /mercari\.com\/(?:us\/)?item\//i.test(url);
    case "Poshmark":
      return /poshmark\.com\/listing\//i.test(url);
    case "eBay":
      return /ebay\.com\/itm\/\d+/i.test(url);
    default:
      return /^https:\/\//.test(url) && !/marketplace\/you/i.test(url);
  }
}

export function openListingLink(
  platform: string,
  title: string,
  remoteUrl?: string | null
) {
  if (isPublicItemUrl(platform, remoteUrl)) {
    return { href: remoteUrl as string, label: "Open real listing" };
  }
  if (platform === "Facebook Marketplace" && title.trim()) {
    return {
      href: marketplaceSearchUrl(platform, title),
      label: "Find on Marketplace",
    };
  }
  if (remoteUrl && /^https:\/\//.test(remoteUrl) && !/marketplace\/you/i.test(remoteUrl)) {
    return { href: remoteUrl, label: "Open real listing" };
  }
  return null;
}

export function marketplaceSearchUrl(platform: string, title: string): string {
  const q = encodeURIComponent(title);
  switch (platform) {
    case "Facebook Marketplace":
      return `https://www.facebook.com/marketplace/search/?query=${q}`;
    case "Kijiji":
      return `https://www.kijiji.ca/b-search.html?keywords=${q}`;
    case "OfferUp":
      return `https://offerup.com/search/list/?q=${q}`;
    case "Craigslist":
      return `https://newyork.craigslist.org/search/sss?query=${q}`;
    case "Mercari":
      return `https://www.mercari.com/search/?keyword=${q}`;
    case "Poshmark":
      return `https://poshmark.com/search?query=${q}&type=listings`;
    case "eBay":
      return `https://www.ebay.com/sch/i.html?_nkw=${q}`;
    case "Gmail receipt":
      return "https://mail.google.com";
    default:
      return livePath("", platform);
  }
}

export function decoratePosts(
  listingId: string,
  _title: string,
  posts: PlatformPost[]
): PlatformPost[] {
  return posts.map((post) => ({
    ...post,
    url: post.url || livePath(listingId, post.platform),
    remote_url: post.remote_url,
  }));
}

export function attachPostUrls(listing: Listing): Listing {
  return {
    ...listing,
    platform_posts: decoratePosts(
      listing.id,
      listing.title,
      listing.platform_posts
    ),
  };
}
