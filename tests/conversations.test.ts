import assert from "node:assert/strict";
import test from "node:test";
import {
  buyerNameFromId,
  conversationById,
  conversationsForListing,
  demoConversationId,
} from "../src/lib/conversations.ts";
import type { Message } from "../src/lib/types.ts";

function msg(partial: Partial<Message> & Pick<Message, "conversation_id" | "text">): Message {
  return {
    id: partial.id || crypto.randomUUID(),
    listing_id: partial.listing_id || "listing-1",
    conversation_id: partial.conversation_id,
    buyer_name: partial.buyer_name,
    sender: partial.sender || "buyer",
    text: partial.text,
    action: null,
    decision: "",
    escalate: false,
    escalate_reason: "",
    timestamp: partial.timestamp || new Date().toISOString(),
  };
}

test("splits listing messages into one thread per person", () => {
  const listingId = "a6ca2404";
  const threads = conversationsForListing(listingId, [
    msg({
      conversation_id: `fb:${listingId}:priya-shah`,
      buyer_name: "Priya Shah",
      text: "Still available?",
      timestamp: "2026-09-19T21:00:00.000Z",
    }),
    msg({
      conversation_id: `fb:${listingId}:priya-shah`,
      buyer_name: "Priya Shah",
      sender: "agent",
      text: "Yes, still available.",
      timestamp: "2026-09-19T21:01:00.000Z",
    }),
    msg({
      conversation_id: `fb:${listingId}:marcus`,
      buyer_name: "Marcus",
      text: "Can you do $8?",
      timestamp: "2026-09-19T21:02:00.000Z",
    }),
  ], { includeDemo: false });

  assert.equal(threads.length, 2);
  assert.equal(threads[0].buyer_name, "Marcus");
  assert.equal(threads[1].buyer_name, "Priya Shah");
  assert.equal(threads[1].messages.length, 2);
});

test("hides the practice Demo thread from Inbox", () => {
  const listingId = "a6ca2404";
  const threads = conversationsForListing(listingId, [
    msg({ conversation_id: "buyer-1", text: "Still available?" }),
  ], { includeDemo: false });
  assert.equal(threads.length, 0);
});

test("keeps a practice Demo thread when asked", () => {
  const listingId = "3878066a";
  const threads = conversationsForListing(listingId, [], { includeDemo: true });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, demoConversationId(listingId));
  assert.equal(threads[0].buyer_name, "Demo");
  assert.equal(threads[0].demo, true);
});

test("legacy buyer-1 messages fold into the demo thread", () => {
  const listingId = "listing-1";
  const found = conversationById(listingId, [
    msg({ conversation_id: "buyer-1", text: "Hi" }),
  ], demoConversationId(listingId));
  assert.equal(found?.messages.length, 1);
  assert.equal(found?.buyer_name, "Demo");
});

test("drops Marketplace chrome that is not a person", () => {
  const listingId = "a6ca2404";
  const threads = conversationsForListing(listingId, [
    msg({
      conversation_id: `fb:${listingId}:privacy-support`,
      buyer_name: "Privacy Support",
      text: "Leave group",
    }),
    msg({
      conversation_id: `fb:${listingId}:facebook-marketplace-assistant`,
      buyer_name: "Facebook Marketplace Assistant",
      text: "Leave group",
    }),
    msg({
      conversation_id: `fb:${listingId}:priya-shah`,
      buyer_name: "Priya Shah",
      text: "Still available?",
    }),
    msg({
      conversation_id: `fb:${listingId}:kesh-dhali`,
      buyer_name: "Kesh Dhali",
      text: "Block",
    }),
  ], { includeDemo: false });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].buyer_name, "Priya Shah");
});

test("keeps a short Marketplace hello", () => {
  const listingId = "555f56bc";
  const threads = conversationsForListing(listingId, [
    msg({
      conversation_id: `fb:${listingId}:alex-chen`,
      buyer_name: "Alex Chen",
      text: "Hi",
    }),
  ], { includeDemo: false });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].buyer_name, "Alex Chen");
});

test("reads a buyer name from a Facebook thread id", () => {
  assert.equal(buyerNameFromId("fb:abc:jordan-chen"), "Jordan Chen");
  assert.equal(buyerNameFromId("fb:abc:x", "Priya Shah"), "Priya Shah");
});

test("keeps real Craigslist and eBay buyers, drops marketplace chrome", () => {
  const listingId = "3878066a";
  const threads = conversationsForListing(listingId, [
    msg({
      conversation_id: `cl:${listingId}:priya-shah`,
      buyer_name: "Priya Shah",
      text: "Still available?",
    }),
    msg({
      conversation_id: `ebay:${listingId}:ebay-member`,
      buyer_name: "eBay Member",
      text: "Shipping update",
    }),
    msg({
      conversation_id: `cl:${listingId}:craigslist`,
      buyer_name: "Craigslist",
      text: "Your posting will expire",
    }),
  ], { includeDemo: false });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].buyer_name, "Priya Shah");
});
