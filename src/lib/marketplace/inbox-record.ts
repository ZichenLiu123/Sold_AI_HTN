import { insertMessage, listMessages, logAgent } from "../db";
import type { Listing, Platform } from "../types";
import { runNegotiator } from "../agents/graph";
import {
  alreadySeenInbound,
  isRealBuyerMessage,
  looksLikePersonName,
  marketplaceThreadId,
  resolveThreadListing,
} from "./facebook-inbox-match";

export type WatchedThread = {
  buyer: string;
  hint: string;
  preview: string;
};

export async function recordMarketplaceInbound(
  listings: Listing[],
  platform: Platform,
  thread: WatchedThread
): Promise<"stored" | "skipped" | "escalated"> {
  if (!looksLikePersonName(thread.buyer)) return "skipped";
  const inbound = thread.preview.replace(/\s+/g, " ").trim();
  if (!isRealBuyerMessage(inbound)) return "skipped";

  const listing = resolveThreadListing(
    `${thread.hint} ${thread.preview} ${thread.buyer}`,
    listings
  );
  if (!listing) return "skipped";

  const conversationId = marketplaceThreadId(platform, listing.id, thread.buyer);
  const history = (await listMessages(listing.id)).filter(
    (message) => message.conversation_id === conversationId
  );
  if (alreadySeenInbound(history, inbound)) return "skipped";

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
    `New ${platform} message from ${thread.buyer}: “${inbound.slice(0, 80)}”`
  );

  const result = await runNegotiator(listing, inbound);
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
    await logAgent(
      listing.id,
      "negotiator",
      "DRAFT",
      `Accept draft for ${thread.buyer} on ${platform}. Waiting for stamp — not marked sold.`
    );
  }
  if (result.escalate) {
    await logAgent(
      listing.id,
      "negotiator",
      "ESCALATE",
      `Did not type on ${platform}. ${result.escalate_reason || result.decision}`
    );
    return "escalated";
  }
  await logAgent(
    listing.id,
    "negotiator",
    "HOLD",
    `Drafted a reply in Sold for ${thread.buyer} on ${platform}. Did not send it.`
  );
  return "stored";
}

export function liveOnPlatform(listings: Listing[], platform: Platform) {
  return listings.filter(
    (listing) =>
      listing.status === "live" &&
      listing.platform_posts.some(
        (post) =>
          post.platform === platform &&
          post.status === "posted" &&
          post.remote_state !== "review"
      )
  );
}
