import { NextResponse } from "next/server";
import { getListing } from "@/lib/db";
import { takedownListing } from "@/lib/agents/takedown";
import { isAgentCancelled } from "@/lib/agents/cancel";
import { withOwnedListing } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withOwnedListing(id, async (_user, listing) => {
    if (listing.status !== "live" && listing.status !== "posting") {
      return NextResponse.json(
        { error: "Only a live listing can be taken down." },
        { status: 400 }
      );
    }
    try {
      const result = await takedownListing(listing);
      return NextResponse.json(result);
    } catch (error) {
      if (isAgentCancelled(error)) {
        return NextResponse.json({
          listing: await getListing(id),
          detail: "Stopped.",
        });
      }
      const message =
        error instanceof Error
          ? error.message
          : "Could not take the listing down.";
      return NextResponse.json(
        {
          error: /402|browser minutes|browserbase\.com\/plans/i.test(message)
            ? "The remote Craigslist browser is out of minutes. Connect Craigslist in Chrome on this Mac, then take it down."
            : message,
        },
        { status: 500 }
      );
    }
  });
}
