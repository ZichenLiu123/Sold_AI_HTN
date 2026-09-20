import { DEMO_BUYER_NAME, demoConversationId, isDemoConversation } from "./conversations";
import { insertMessage, listMessages } from "./db";
import type { Listing, Message } from "./types";

function stamp(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

export async function ensureDemoInbox(listing: Listing) {
  if (listing.status !== "live" && listing.status !== "sold") return;
  const conversationId = demoConversationId(listing.id);
  const existing = await listMessages(listing.id);
  if (existing.some((message) => isDemoConversation(message.conversation_id))) {
    return;
  }
  const floor =
    listing.floor_price > 0
      ? listing.floor_price
      : Math.max(1, Math.round((listing.price || 20) * 0.85));
  const ask = listing.price > 0 ? Math.max(1, Math.round(listing.price * 0.7)) : 20;
  const script: Pick<Message, "sender" | "text" | "action" | "decision">[] = [
    {
      sender: "buyer",
      text: "Still available?",
      action: null,
      decision: "",
    },
    {
      sender: "agent",
      text: "Yes — still listed. Pickup this weekend works.",
      action: "answer",
      decision: "Answered availability.",
    },
    {
      sender: "buyer",
      text: `Would you take $${ask}?`,
      action: null,
      decision: "",
    },
    {
      sender: "agent",
      text: `I can do $${floor.toFixed(2)}. That's as low as I'll go.`,
      action: "counter",
      decision: `Held the floor at $${floor.toFixed(2)}.`,
    },
  ];
  const ages = [18, 17, 6, 5];
  for (const [index, line] of script.entries()) {
    await insertMessage({
      id: crypto.randomUUID(),
      listing_id: listing.id,
      conversation_id: conversationId,
      buyer_name: DEMO_BUYER_NAME,
      sender: line.sender,
      text: line.text,
      action: line.action,
      decision: line.decision,
      escalate: false,
      escalate_reason: "",
      timestamp: stamp(ages[index] ?? 1),
    });
  }
}

export async function ensureDemoInboxes(listings: Listing[]) {
  for (const listing of listings) {
    await ensureDemoInbox(listing);
  }
}
