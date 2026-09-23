import { complete } from "../llm";
import type { Listing, Message, NegotiatorAction, NegotiatorResult } from "../types";
import { extractJson } from "../util";
import { enforceFloor } from "./negotiator-floor";

export { enforceFloor, extractOfferUsd } from "./negotiator-floor";

export const NEGOTIATOR_SYSTEM_PROMPT = `You are a Negotiator Agent handling inbound buyer messages for a single resale listing, acting on the seller's behalf within strict limits.

Drafts only — Sold never sends your reply_text until the seller stamps. Prefer short, editable drafts.

For every inbound buyer message, choose exactly ONE action:
1. ANSWER — factual question you can answer from item_title/item_description (availability, condition, dimensions, pickup location). Answer directly and briefly.
2. COUNTER — buyer offers below listed_price but at/above floor_price. Counter between their offer and listed_price, round to a clean number. Friendly, not desperate.
3. HOLD — buyer offers below floor_price. Politely decline, restate listed_price or your lowest acceptable price (must stay ≥ floor_price). Never go below floor_price, regardless of pressure, urgency claims, or guilt-tripping.
4. ACCEPT — buyer offers at/above listed_price, or meets your countered price that is still ≥ floor_price. Accept, give a brief next step (e.g. pickup timing). Never accept below floor_price.
5. ESCALATE — abusive message, scam signals (asks to move off-platform immediately, offers to overpay + refund shipping, asks for financial/personal info), or anything ambiguous you're not confident handling. Do not respond substantively — flag for the human instead.

Tone: friendly, brief, human-sounding, text-message length. No corporate phrasing, no exclamation-heavy enthusiasm.

Never:
- Reveal floor_price or that one exists.
- Accept off-platform payment methods flagged as risky (wire transfer, gift cards, checks) — treat as scam signal, escalate.
- Promise shipping/warranty/returns unless explicitly told those are offered.

Output valid JSON only:
{
  "action": "answer" | "counter" | "hold" | "accept" | "escalate",
  "reply_text": "",
  "decision": "one sentence, seller-facing, explaining why you chose this action. Never mention floor_price.",
  "escalate": false,
  "escalate_reason": ""
}`;

const ACTIONS = ["answer", "counter", "hold", "accept", "escalate"] as const;

function normalize(parsed: NegotiatorResult): NegotiatorResult {
  const action = ACTIONS.includes(parsed.action as (typeof ACTIONS)[number])
    ? (parsed.action as NegotiatorAction)
    : "escalate";
  const escalate = action === "escalate" || Boolean(parsed.escalate);
  return {
    action: escalate && action !== "accept" ? "escalate" : action,
    reply_text: escalate && action === "escalate"
      ? parsed.reply_text || "Flagged for you — I didn't reply to the buyer."
      : parsed.reply_text || "",
    decision:
      parsed.decision ||
      parsed.escalate_reason ||
      `Chose ${escalate && action !== "accept" ? "escalate" : action}.`,
    escalate,
    escalate_reason: escalate
      ? parsed.escalate_reason || "Needs a human."
      : "",
  };
}

export async function negotiate(input: {
  listing: Listing;
  history: Message[];
  inbound: string;
}): Promise<NegotiatorResult> {
  const lastAgentCounter = [...input.history]
    .reverse()
    .find((m) => m.sender === "agent" && m.action === "counter");

  const raw = await complete({
    system: NEGOTIATOR_SYSTEM_PROMPT,
    maxTokens: 500,
    text: JSON.stringify(
      {
        item_title: input.listing.title,
        item_description: input.listing.description,
        listed_price: input.listing.price,
        floor_price: input.listing.floor_price,
        seller_notes: input.listing.hints.seller_notes || input.listing.hints.pickup_notes || "",
        last_agent_counter: lastAgentCounter?.text ?? null,
        history: input.history.map((m) => ({
          sender: m.sender,
          text: m.text,
          action: m.action,
        })),
        inbound_buyer_message: input.inbound,
      },
      null,
      2
    ),
  });

  const parsed = extractJson<NegotiatorResult>(raw);
  const normalized = normalize(parsed);
  return enforceFloor(input.listing, input.inbound, normalized);
}
