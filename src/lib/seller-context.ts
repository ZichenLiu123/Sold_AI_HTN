import { AsyncLocalStorage } from "node:async_hooks";
import { authConfigured } from "./auth";
import { DEMO_USER } from "./types";

const storage = new AsyncLocalStorage<string>();

/** Run work scoped to a seller user id (request auth or monitor tick). */
export function runAsUser<T>(userId: string, fn: () => T): T {
  return storage.run(userId, fn);
}

export async function runAsUserAsync<T>(
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(userId, fn);
}

/**
 * Active seller for marketplace + profile reads.
 * Prefer request/monitor context; fall back to demo only when auth is off.
 */
export function sellerId(): string {
  const id = storage.getStore();
  if (id) return id;
  if (!authConfigured()) return DEMO_USER.id;
  throw new Error("Seller context missing — sign in required.");
}

export function trySellerId(): string | null {
  const id = storage.getStore();
  if (id) return id;
  if (!authConfigured()) return DEMO_USER.id;
  return null;
}
