import type { Listing, Message } from "../types";

const TITLE_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "item",
  "sale",
  "very",
  "just",
]);

const NAV_LABEL =
  /^(marketplace|inbox|unread|selling|buying|notifications|home|watchlist|you|menu|search|create|chats|marketplace inbox|see all|filters|new see all)$/i;

const NOTIFICATION_NOISE =
  /friend suggestion|posted on threads|trying to log in|silver sponsors|career fair|started following|accepted your|commented on|reacted to|memories|are now friends|tagged you|invitation/i;

export type InboxThread = {
  buyer: string;
  hint: string;
  preview: string;
  lastFrom: "buyer" | "seller" | "unknown";
  href: string;
  raw: string;
};

export type ThreadMessage = {
  from: "buyer" | "seller";
  text: string;
};

export function normalizeMessage(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function titleTokens(title: string) {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !TITLE_STOP.has(word));
}

export function matchListingToText<T extends Pick<Listing, "id" | "title">>(
  text: string,
  listings: T[]
): T | null {
  const hay = text.toLowerCase();
  let best: T | null = null;
  let bestScore = 0;
  for (const listing of listings) {
    const tokens = titleTokens(listing.title);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((token) => hay.includes(token)).length;
    const score = hits / tokens.length;
    if (hits >= Math.min(2, tokens.length) && score > bestScore) {
      best = listing;
      bestScore = score;
    }
  }
  return best;
}

const INBOX_CHROME_BUYER =
  /unread message|marketplace\s*unread|\d+\s+new messages?|^marketplace$|^inbox$|^selling$|^buying$|^unread$|seller dashboard|your listings|announcements|^insights$|marketplace profile|conversation details|^enter,?$|chat members|group creator|add people|mute notifications|read receipts|media, files|give feedback|^report$/i;

const UI_THREAD =
  /^\d+\s+new messages?$|^chats$|^marketplace inbox$|^privacy & support$|^customize chat$|^leave group$/i;

export function isInboxChromeBuyer(name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  return INBOX_CHROME_BUYER.test(clean) || UI_THREAD.test(clean);
}

const MARKETPLACE_CHROME =
  /privacy(?:\s|&)+support|customize chat|leave group|marketplace inbox|see all|help center|chat settings/i;

const FACEBOOK_SYSTEM =
  /marketplace assistant|facebook assistant|meta ai|^facebook user$|marketplace support|^support inbox$|^e ?bay(?: member| customer(?: service)?)?$|^craigslist(?: user)?$|^system message$|^automated message$/i;

const THREAD_CHROME =
  /^(leave group|privacy(?:\s|&)+support|customize chat|chat settings|block|report|sorry,?\s*it'?s not available\.?|·?\s*\d+[smhdy])$/i;

export function isFacebookSystemBuyer(name: string) {
  return FACEBOOK_SYSTEM.test(name.replace(/\s+/g, " ").trim());
}

export function looksLikePersonName(name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length < 2 || clean.length > 50) return false;
  if (
    NAV_LABEL.test(clean) ||
    UI_THREAD.test(clean) ||
    MARKETPLACE_CHROME.test(clean) ||
    FACEBOOK_SYSTEM.test(clean) ||
    isInboxChromeBuyer(clean)
  ) {
    return false;
  }
  return /[a-z]/i.test(clean);
}

export function looksLikeBuyerThread(text: string) {
  if (
    NOTIFICATION_NOISE.test(text) ||
    UI_THREAD.test(text.trim()) ||
    MARKETPLACE_CHROME.test(text) ||
    FACEBOOK_SYSTEM.test(text) ||
    THREAD_CHROME.test(text.trim()) ||
    isInboxChromeBuyer(text)
  ) {
    return false;
  }
  return true;
}

export function isThreadChrome(text: string) {
  return THREAD_CHROME.test(text.replace(/\s+/g, " ").trim());
}

const BUYER_SIGNAL =
  /\b(available|availble|still|price|offer|pick ?up|cash|venmo|paypal|sold|interested|how much|can you|would you|take \$|is this|condition|flaws?|lowest|nego)\b/i;

const PLACE_ONLY = /^[A-Za-z .'-]{2,40},\s*[A-Z]{2}(?:\s+\d{5})?$/;

export function isRealBuyerMessage(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || isThreadChrome(clean) || FACEBOOK_SYSTEM.test(clean)) return false;
  if (MARKETPLACE_CHROME.test(clean) || UI_THREAD.test(clean) || isInboxChromeBuyer(clean)) {
    return false;
  }
  if (PLACE_ONLY.test(clean)) return false;
  return BUYER_SIGNAL.test(clean) || /^(hi|hey|hello|interested)\b/i.test(clean);
}

export function matchListingByRemoteItem<
  T extends {
    id: string;
    title: string;
    platform_posts?: { platform: string; remote_url?: string }[];
  },
>(text: string, listings: T[]): T | null {
  const ids = [...text.matchAll(/marketplace\/item\/(\d+)/gi)].map((match) => match[1]);
  if (!ids.length) return null;
  for (const listing of listings) {
    for (const post of listing.platform_posts || []) {
      const id = post.remote_url?.match(/item\/(\d+)/i)?.[1];
      if (id && ids.includes(id)) return listing;
    }
  }
  return null;
}

export function resolveThreadListing<
  T extends Pick<Listing, "id" | "title"> & {
    platform_posts?: { platform: string; remote_url?: string }[];
  },
>(text: string, listings: T[]): T | null {
  const byItem = matchListingByRemoteItem(text, listings);
  if (byItem) return byItem;
  const matched = matchListingToText(text, listings);
  if (matched) return matched;
  if (listings.length === 1 && looksLikeBuyerThread(text)) return listings[0];
  return null;
}

export function facebookThreadId(buyer: string, listingId: string) {
  return marketplaceThreadId("Facebook Marketplace", listingId, buyer);
}

export function marketplaceThreadId(
  platform: string,
  listingId: string,
  buyer: string
) {
  const prefix =
    (
      {
        "Facebook Marketplace": "fb",
        Craigslist: "cl",
        eBay: "ebay",
        Kijiji: "kijiji",
        OfferUp: "offerup",
        Mercari: "mercari",
        Poshmark: "poshmark",
      } as Record<string, string>
    )[platform] ||
    platform
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 12) ||
    "mp";
  const slug =
    buyer
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "buyer";
  return `${prefix}:${listingId}:${slug}`;
}

export function parseMarketplaceNotice(text: string) {
  const clean = text
    .replace(/\s+/g, " ")
    .replace(/^(marketplace|notifications?)\s*[·|\-–]\s*/i, "")
    .trim();
  const match = clean.match(
    /([A-Za-z][A-Za-z.'-]{1,20}(?:\s+[A-Za-z][A-Za-z.'-]{1,20}){0,3}) (?:sent you a message|messaged you|is interested)(?: about| in)?(?: your listing)?[:\s]*(.*)$/i
  );
  if (!match) return null;
  const buyer = match[1].trim();
  if (!looksLikePersonName(buyer)) return null;
  const rest = (match[2] || "").replace(/\s*·\s*\d+[smhdwy].*$/i, "").trim();
  return {
    buyer,
    hint: rest,
    preview: rest || "Reached out on Marketplace.",
  };
}

export function parseThreadPreview(text: string): {
  buyer: string;
  hint: string;
  preview: string;
} {
  const parts = text
    .split(/\s*\|\s*|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(
      (part) =>
        part &&
        !NAV_LABEL.test(part) &&
        !/^\d+\s*[smhd]$/i.test(part) &&
        part.length < 160
    );
  const buyer = (parts[0] || "Buyer").replace(/^unread/i, "").trim() || "Buyer";
  return {
    buyer,
    hint: parts[1] || "",
    preview: parts.slice(2).join(" ") || parts.at(-1) || "",
  };
}

export function parseInboxRow(text: string) {
  const parsed = parseThreadPreview(text);
  if (
    looksLikePersonName(parsed.buyer) &&
    parsed.preview &&
    parsed.preview !== parsed.buyer &&
    !/^(re:|fwd:)$/i.test(parsed.preview)
  ) {
    return parsed;
  }
  const clean = text.replace(/\s+/g, " ").trim();
  const named = clean.match(
    /^([A-Za-z][A-Za-z.'-]{1,20}(?:\s+[A-Z]\.?)?(?:\s+[A-Za-z][A-Za-z.'-]{1,20})?)\s+(?:Re:\s*|Fwd:\s*)?(.{8,})$/
  );
  if (!named) return null;
  const buyer = named[1].trim();
  if (!looksLikePersonName(buyer)) return null;
  const rest = named[2].replace(/^(?:Re:|Fwd:)\s*/i, "").trim();
  if (!rest) return null;
  return { buyer, hint: rest, preview: rest };
}

export function alreadySeenInbound(
  history: Pick<Message, "sender" | "text">[],
  inbound: string
) {
  const needle = normalizeMessage(inbound);
  if (!needle) return true;
  return history.some(
    (message) =>
      message.sender === "buyer" && normalizeMessage(message.text) === needle
  );
}

export function sellerTookOver(history: Pick<Message, "sender">[]) {
  return history.at(-1)?.sender === "human";
}

export function lastBuyerText(messages: ThreadMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.from === "buyer" && message.text.trim())
      ?.text.trim() || ""
  );
}

export type SellingCardState = "active" | "review" | "sold" | "deleted";

export type SellingCard = {
  text: string;
  href: string;
  state: SellingCardState;
};

export type SellingScan = {
  loaded: boolean;
  empty: boolean;
  cards: SellingCard[];
  body?: string;
};

export function classifySellingText(text: string): SellingCardState {
  if (
    /deleted|no longer available|this listing isn'?t available|removed this listing|listing was deleted|inactive|expired|hidden|declined/i.test(
      text
    )
  ) {
    return "deleted";
  }
  if (/\bmarked as sold\b|\bbuyer found\b|\bsold\b/i.test(text)) return "sold";
  if (/in review|pending review|under review/i.test(text)) return "review";
  return "active";
}

export function sellingPresence(
  listing: Pick<Listing, "id" | "title">,
  scan: SellingScan
): "active" | "review" | "sold" | "deleted" | "missing" | "unknown" {
  if (!scan.loaded) return "unknown";
  const hits = scan.cards.filter((card) => matchListingToText(card.text, [listing]));
  if (hits.some((card) => card.state === "deleted")) return "deleted";
  if (hits.some((card) => card.state === "sold")) return "sold";
  if (hits.some((card) => card.state === "review")) return "review";
  if (hits.some((card) => card.state === "active")) return "active";
  if (scan.body && matchListingToText(scan.body, [listing])) {
    return /in review|pending review|under review/i.test(scan.body) ? "review" : "active";
  }
  if (scan.cards.length === 0 && !scan.empty) return "unknown";
  return "missing";
}
