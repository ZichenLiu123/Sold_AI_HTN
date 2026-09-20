import type { Message } from "./types";

const CHROME_BUYER =
  /privacy(?:\s|&)+support|customize chat|leave group|marketplace inbox|see all|help center|chat settings|marketplace assistant|facebook assistant|meta ai|^e ?bay(?: member)?$|^craigslist(?: user)?$/i;

const CHROME_LINE =
  /^(leave group|block|report|sorry,?\s*it'?s not available\.?|·?\s*\d+[smhdy])$/i;

export const DEMO_BUYER_NAME = "Demo";

export type ListingConversation = {
  id: string;
  listing_id: string;
  buyer_name: string;
  demo: boolean;
  messages: Message[];
  last: Message | null;
};

export function demoConversationId(listingId: string) {
  return `demo:${listingId}:jordan`;
}

export function isDemoConversation(conversationId: string) {
  return (
    conversationId === "buyer-1" ||
    conversationId.endsWith(":jordan") && conversationId.startsWith("demo:")
  );
}

export function buyerNameFromId(conversationId: string, stored?: string | null) {
  if (isDemoConversation(conversationId)) {
    if (!stored?.trim() || stored.trim() === "Jordan") return DEMO_BUYER_NAME;
    return stored.trim();
  }
  if (stored?.trim()) return stored.trim();
  const slug = conversationId.split(":").at(-1) || "buyer";
  const named = slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
  return named || "Buyer";
}

export function conversationsForListing(
  listingId: string,
  messages: Message[],
  options?: { includeDemo?: boolean }
): ListingConversation[] {
  const groups = new Map<string, Message[]>();
  for (const message of messages) {
    const id =
      message.conversation_id === "buyer-1"
        ? demoConversationId(listingId)
        : message.conversation_id || demoConversationId(listingId);
    const list = groups.get(id) || [];
    list.push(message);
    groups.set(id, list);
  }

  if ((options?.includeDemo ?? true) && !groups.has(demoConversationId(listingId))) {
    groups.set(demoConversationId(listingId), []);
  }

  return [...groups.entries()]
    .map(([id, rows]) => {
      const named = rows.find((row) => row.buyer_name)?.buyer_name;
      const buyer_name = buyerNameFromId(id, named);
      return {
        id,
        listing_id: listingId,
        buyer_name,
        demo: isDemoConversation(id),
        messages: rows,
        last: rows[rows.length - 1] || null,
      };
    })
    .filter((thread) => {
      if (thread.demo) return options?.includeDemo ?? true;
      if (CHROME_BUYER.test(thread.buyer_name)) return false;
      return thread.messages.some((message) => {
        const text = message.text.replace(/\s+/g, " ").trim();
        return message.sender === "buyer" && text.length >= 2 && !CHROME_LINE.test(text);
      });
    })
    .sort((a, b) => {
      const aTime = a.last?.timestamp || "";
      const bTime = b.last?.timestamp || "";
      if (aTime === bTime) {
        if (a.demo !== b.demo) return a.demo ? 1 : -1;
        return a.buyer_name.localeCompare(b.buyer_name);
      }
      return aTime > bTime ? -1 : 1;
    });
}

export function conversationById(
  listingId: string,
  messages: Message[],
  conversationId: string | null
) {
  const threads = conversationsForListing(listingId, messages, { includeDemo: true });
  if (!conversationId) return null;
  const wanted =
    conversationId === "buyer-1" ? demoConversationId(listingId) : conversationId;
  return threads.find((thread) => thread.id === wanted) || null;
}
