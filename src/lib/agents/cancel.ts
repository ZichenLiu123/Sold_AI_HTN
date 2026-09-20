export class AgentCancelled extends Error {
  constructor() {
    super("Stopped.");
    this.name = "AgentCancelled";
  }
}

const cancelled = new Set<string>();

export function requestCancel(listingId: string) {
  cancelled.add(listingId);
}

export function clearCancel(listingId: string) {
  cancelled.delete(listingId);
}

export function isCancelled(listingId: string) {
  return cancelled.has(listingId);
}

export function isAgentCancelled(error: unknown) {
  return error instanceof AgentCancelled || (error instanceof Error && error.name === "AgentCancelled");
}

export function throwIfCancelled(listingId: string) {
  if (cancelled.has(listingId)) throw new AgentCancelled();
}
