import { NextResponse } from "next/server";
import { getListing } from "@/lib/db";
import { runLister } from "@/lib/agents/graph";
import { isEphemeralFs } from "@/lib/storage";
import type { Listing } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const inflight = new Map<string, Promise<Listing | undefined>>();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const force = new URL(req.url).searchParams.get("force") === "1";
  const listing = await getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!force && (listing.status === "ready" || listing.status === "live" || listing.status === "sold")) {
    return NextResponse.json(listing);
  }

  if (isEphemeralFs()) {
    const origin =
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      new URL(req.url).origin;
    const kicked = await fetch(`${origin}/.netlify/functions/lister-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, force }),
    });
    if (!kicked.ok && kicked.status !== 202) {
      return NextResponse.json(
        { error: `Could not start lister (${kicked.status})`, listing },
        { status: 502 }
      );
    }
    return NextResponse.json(listing, { status: 202 });
  }

  const existing = inflight.get(id);
  if (!existing) {
    const promise = runLister(listing)
      .catch(() => undefined)
      .finally(() => inflight.delete(id));
    inflight.set(id, promise);
  }
  return NextResponse.json(listing, { status: 202 });
}
