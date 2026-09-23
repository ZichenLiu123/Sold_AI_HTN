import { NextResponse } from "next/server";
import {
  AuthRequiredError,
  authErrorResponse,
  requireUser,
  type AuthUser,
} from "@/lib/auth";
import { getListing, listingOwnedBySeller } from "@/lib/db";
import { runAsUserAsync } from "@/lib/seller-context";
import type { Listing } from "@/lib/types";

export async function withSeller<T>(
  fn: (user: AuthUser) => Promise<T>
): Promise<T> {
  const user = await requireUser();
  return runAsUserAsync(user.id, () => fn(user));
}

/** Same as withSeller — for RSC pages that need seller-scoped DB reads. */
export async function asSellerPage<T>(
  fn: (user: AuthUser) => Promise<T>
): Promise<T> {
  return withSeller(fn);
}

/** Auth + seller ALS + owned listing, or a 404 Response. */
export async function withOwnedListing(
  id: string,
  fn: (user: AuthUser, listing: Listing) => Promise<Response>
): Promise<Response> {
  try {
    return await withSeller(async (user) => {
      const listing = await getListing(id);
      if (!listing || !listingOwnedBySeller(listing, user.id)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return fn(user, listing);
    });
  } catch (error) {
    return apiError(error);
  }
}

export function apiError(error: unknown, fallback = "Request failed.") {
  const auth = authErrorResponse(error);
  if (auth) return auth;
  const message = error instanceof Error ? error.message : fallback;
  const status = error instanceof AuthRequiredError ? 401 : 500;
  return NextResponse.json({ error: message }, { status });
}
