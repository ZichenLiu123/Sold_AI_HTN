import {
  facebookListingGone,
  facebookListingReview,
} from "@/lib/marketplace/policy";
import type { Listing, NegotiatorAction } from "@/lib/types";

export function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export function floorCaption(listing: Listing): string {
  if (facebookListingGone(listing)) return "Gone from Facebook";
  if (listing.status === "sold") return "Sold";
  if (listing.status === "rejected") {
    return /taken down/i.test(listing.pipeline_stage || "") ? "Taken down" : "Not posted";
  }
  if (listing.status === "live") {
    const names = listing.platform_posts
      .filter(
        (post) =>
          post.platform !== "Gmail receipt" &&
          post.status === "posted" &&
          post.remote_state !== "review"
      )
      .map((post) => post.platform.replace(" Marketplace", ""));
    if (names.length === 1) return `Live on ${names[0]}`;
    if (names.length === 2) return `Live on ${names[0]} and ${names[1]}`;
    if (names.length > 2) return `Live on ${names.length} marketplaces`;
    return "Live";
  }
  if (listing.status === "posting") {
    return facebookListingReview(listing)
      ? "Facebook is reviewing it"
      : "Posting now";
  }
  if (listing.status === "error") {
    const failed = listing.platform_posts.find(
      (post) =>
        post.platform !== "Gmail receipt" &&
        (post.status === "failed" || post.status === "needs_attention")
    );
    if (failed) {
      return `Didn’t go live on ${failed.platform.replace(" Marketplace", "")}`;
    }
    return "Didn’t go live";
  }
  if (listing.status === "ready") return "Needs your review";
  if (listing.status === "analyzing") {
    return listing.pipeline_stage || "Writing the listing";
  }
  return listing.pipeline_stage || "Draft";
}

export function statusLabel(status: Listing["status"]): string {
  switch (status) {
    case "analyzing":
      return "Writing";
    case "ready":
      return "Review";
    case "posting":
      return "Posting";
    case "live":
      return "Live";
    case "sold":
      return "Sold";
    case "rejected":
      return "Rejected";
    case "error":
      return "Stuck";
    default:
      return "Draft";
  }
}

const ACTION_CLASS: Record<NegotiatorAction, string> = {
  answer: "text-sage border-sage",
  counter: "text-gold border-gold",
  hold: "text-ink border-ink",
  accept: "text-sold border-sold",
  escalate: "text-paper bg-ink border-ink",
};

export function ActionStamp({ action }: { action: NegotiatorAction }) {
  return (
    <span className={`stamp rotate-0 text-[10px] ${ACTION_CLASS[action]}`}>
      {action}
    </span>
  );
}
