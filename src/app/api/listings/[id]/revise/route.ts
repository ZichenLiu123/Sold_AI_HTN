import { NextResponse } from "next/server";
import { getListing } from "@/lib/db";
import { hasListingEdits, reviseListing, type ListingRevise } from "@/lib/agents/revise";
import { listingChatReady } from "@/lib/marketplace/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const listing = await getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!listingChatReady(listing) && listing.status !== "live") {
    return NextResponse.json(
      { error: "The listing has to be live before Sold can edit it on the marketplace." },
      { status: 400 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    edits?: ListingRevise;
  };
  const edits = body.edits && hasListingEdits(body.edits) ? body.edits : null;
  const prompt = (body.prompt || "").trim();
  if (!edits && !prompt) {
    return NextResponse.json({ error: "Change a field, then save." }, { status: 400 });
  }
  try {
    const result = await reviseListing(listing, edits || prompt);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not update the live listing.",
      },
      { status: 500 }
    );
  }
}
