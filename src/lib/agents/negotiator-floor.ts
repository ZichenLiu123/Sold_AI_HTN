import type { Listing, NegotiatorResult } from "../types";

/** Pull the clearest dollar amount from buyer text (last $ match wins). */
export function extractOfferUsd(text: string): number | null {
  const dollar = [...text.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)];
  if (dollar.length > 0) {
    const n = Number(dollar[dollar.length - 1][1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const bare = text.match(/\b(\d{2,5})(?:\.\d{1,2})?\b/);
  if (!bare) return null;
  const n = Number(bare[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Deterministic guard — LLM cannot accept or counter below floor.
 * Pattern used by reliable negotiation systems: typed limits beat free-text models.
 */
export function enforceFloor(
  listing: Listing,
  inbound: string,
  result: NegotiatorResult,
): NegotiatorResult {
  const floor = listing.floor_price ?? 0;
  const ask = listing.price ?? floor;
  if (floor <= 0) {
    if (result.action === "accept") {
      return {
        ...result,
        escalate: true,
        escalate_reason:
          result.escalate_reason ||
          "Needs your stamp before Sold marks this sold.",
        decision:
          result.decision ||
          "Accept draft ready — stamp to mark sold.",
      };
    }
    return result;
  }

  const offer = extractOfferUsd(inbound);

  if (result.action === "accept") {
    if (offer != null && offer < floor) {
      return {
        action: "hold",
        reply_text: `I can do $${floor} if that works for you.`,
        decision: "Offer is under your floor — held and restated the lowest acceptable price.",
        escalate: false,
        escalate_reason: "",
      };
    }
    if (offer == null) {
      return {
        action: "escalate",
        reply_text: "",
        decision: "Accept blocked — no clear dollar amount at or above your floor.",
        escalate: true,
        escalate_reason: "Needs a clear offer before Sold can stamp accept.",
      };
    }
    return {
      ...result,
      escalate: true,
      escalate_reason: "Needs your stamp before Sold marks this sold.",
      decision:
        result.decision ||
        `Accept draft at $${offer} (ask $${ask}). Stamp to mark sold.`,
    };
  }

  if (result.action === "counter") {
    const counterOffer = extractOfferUsd(result.reply_text);
    if (counterOffer != null && counterOffer < floor) {
      return {
        ...result,
        reply_text: `Lowest I can do is $${floor}. Happy to set a pickup time.`,
        decision: "Counter rewritten to stay at or above your floor.",
      };
    }
  }

  if (result.action === "hold" && offer != null && offer < floor) {
    const proposed = extractOfferUsd(result.reply_text);
    if (proposed != null && proposed < floor) {
      return {
        ...result,
        reply_text: `I need to stay at $${floor}.`,
        decision: "Hold reply rewritten so it never quotes under your floor.",
      };
    }
  }

  return result;
}
