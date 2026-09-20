import type { Listing, ListingStatus } from "../types";

export class AgentCancelled extends Error {
  constructor() {
    super("Stopped.");
    this.name = "AgentCancelled";
  }
}

const cancelled = new Set<string>();
const running = new Set<string>();

export function requestCancel(listingId: string) {
  cancelled.add(listingId);
}

export function clearCancel(listingId: string) {
  cancelled.delete(listingId);
}

export function isCancelled(listingId: string) {
  return cancelled.has(listingId);
}

export function markAgentRunning(listingId: string) {
  running.add(listingId);
}

export function markAgentIdle(listingId: string) {
  running.delete(listingId);
}

export function isAgentRunning(listingId: string) {
  return running.has(listingId);
}

export function isAgentCancelled(error: unknown) {
  return error instanceof AgentCancelled || (error instanceof Error && error.name === "AgentCancelled");
}

export function throwIfCancelled(listingId: string) {
  if (cancelled.has(listingId)) throw new AgentCancelled();
}

export async function waitUntilAgentIdle(listingId: string, ms = 90_000) {
  const started = Date.now();
  while (isAgentRunning(listingId) && Date.now() - started < ms) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return !isAgentRunning(listingId);
}

export function stoppedListingPatch(listing: Pick<Listing, "title" | "status" | "platform_posts">): {
  status: ListingStatus;
  pipeline_stage: string;
  pipeline_error: null;
} {
  const live = listing.platform_posts.some(
    (post) =>
      post.platform !== "Gmail receipt" &&
      post.status === "posted" &&
      post.remote_state !== "review"
  );
  const status: ListingStatus =
    listing.status === "sold" || listing.status === "rejected"
      ? listing.status
      : live
        ? "live"
        : listing.title
          ? "ready"
          : "draft";
  return { status, pipeline_stage: "Stopped", pipeline_error: null };
}
