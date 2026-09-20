import { NextResponse } from "next/server";
import { getListing, logAgent, updateListing } from "@/lib/db";
import {
  clearCancel,
  isAgentRunning,
  requestCancel,
  stoppedListingPatch,
} from "@/lib/agents/cancel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const listing = await getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const working =
    isAgentRunning(id) ||
    listing.status === "analyzing" ||
    listing.status === "posting" ||
    /^stopping/i.test(listing.pipeline_stage || "") ||
    /^taking down live/i.test(listing.pipeline_stage || "") ||
    /^updating live/i.test(listing.pipeline_stage || "") ||
    /^updating (facebook|craigslist|ebay)/i.test(listing.pipeline_stage || "") ||
    /^still opening /i.test(listing.pipeline_stage || "");
  if (!working) {
    return NextResponse.json(listing);
  }
  requestCancel(id);
  if (!isAgentRunning(id)) {
    clearCancel(id);
    const stopped = await updateListing(id, stoppedListingPatch(listing));
    await logAgent(id, "browser", "STOPPED", "Stopped.");
    return NextResponse.json(stopped);
  }
  await updateListing(id, { pipeline_stage: "Stopping…" });
  await logAgent(id, "browser", "STOPPED", "You stopped the agent. It will halt on the next step.");
  return NextResponse.json(await getListing(id));
}
