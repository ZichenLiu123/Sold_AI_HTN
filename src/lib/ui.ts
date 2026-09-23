import type { Listing } from "@/lib/types";

export function statusBadgeClass(listing: Listing, gone = false): string {
  if (gone || listing.status === "rejected") return "badge-draft";
  if (listing.status === "sold" || listing.status === "live") return "badge-live";
  if (listing.status === "posting") return "badge-submitted";
  if (listing.status === "ready") return "badge-submitted";
  return "badge-draft";
}

export function manifestStatus(listing: Listing): {
  label: string;
  note: string;
  url?: string | null;
} {
  const livePost = listing.platform_posts.find(
    (post) =>
      post.platform !== "Gmail receipt" &&
      post.status === "posted" &&
      post.remote_state !== "review" &&
      (post.url || post.remote_url)
  );

  if (listing.status === "sold") {
    return { label: "Sold", note: "Marked sold.", url: livePost?.url || livePost?.remote_url };
  }
  if (livePost) {
    return {
      label: "Live",
      note: "Public URL on file.",
      url: livePost.url || livePost.remote_url,
    };
  }
  if (listing.status === "posting") {
    return {
      label: "Submitted",
      note: "Form filled. Not live until a public URL exists.",
    };
  }
  if (listing.status === "ready") {
    return {
      label: "Draft",
      note: "Ready for your review. Nothing has posted.",
    };
  }
  if (listing.status === "analyzing") {
    return {
      label: "Draft",
      note: listing.pipeline_stage || "Working on the listing.",
    };
  }
  if (listing.status === "error") {
    return {
      label: "Submitted",
      note: listing.pipeline_error || "Did not reach a live URL.",
    };
  }
  return { label: "Draft", note: listing.pipeline_stage || "Not posted." };
}
