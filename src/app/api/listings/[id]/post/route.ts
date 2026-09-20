import { NextResponse } from "next/server";
import { getListing, getPlatformConnection, logAgent, updateListing } from "@/lib/db";
import { postListing } from "@/lib/agents/post";
import {
  facebookListingReview,
  formatPlatformList,
  hasLiveMarketplace,
  missingConnectedPlatforms,
  summarizePostingResults,
  unpublishedMarketplacePlatforms,
} from "@/lib/marketplace/policy";
import { DEMO_USER, type Listing, type Platform, type PlatformConnectionStatus } from "@/lib/types";
import { isAgentCancelled, markAgentIdle, markAgentRunning } from "@/lib/agents/cancel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const inflight = new Map<string, Promise<void>>();

async function finishPosting(id: string) {
  const current = await getListing(id);
  if (!current) return;
  markAgentRunning(id);
  try {
  let platform_posts;
  try {
    platform_posts = await postListing(current);
  } catch (error) {
    if (isAgentCancelled(error)) {
      const latest = await getListing(id);
      const live = latest ? hasLiveMarketplace(latest) : false;
      await updateListing(id, {
        status: live ? "live" : latest?.title ? "ready" : "error",
        pipeline_stage: "Stopped",
        pipeline_error: null,
      });
      await logAgent(id, "browser", "STOPPED", "Stopped. Nothing else will be posted.");
      return;
    }
    platform_posts = current.platforms.map((platform) => ({
      platform,
      status: "failed" as const,
      via: "browserbase" as const,
      detail:
        error instanceof Error
          ? `Did not go live on ${platform}. ${error.message}`
          : `Did not go live on ${platform}.`,
    }));
  }
  const marketplacePosts = platform_posts.filter((post) => post.platform !== "Gmail receipt");
  const summary = summarizePostingResults(platform_posts);
  const live = hasLiveMarketplace({ platform_posts });
  const review = !live && facebookListingReview({ platform_posts });
  await updateListing(id, {
    status: live ? "live" : review ? "posting" : "error",
    pipeline_error: live || review
      ? null
      : "Publishing failed. The listing did not go live on a marketplace.",
    pipeline_stage: live
      ? `Live · ${summary.posted} marketplace posted`
      : review
        ? "Facebook is reviewing the listing"
        : "Failed — listing did not go live",
    platform_posts,
  });
  for (const post of marketplacePosts) {
    await logAgent(
      id,
      "browser",
      post.status === "posted" ? "LIVE" : "FAILED",
      `${post.platform}: ${post.detail || post.status}.`
    );
  }
  await logAgent(
    id,
    "browser",
    live ? "LIVE" : review ? "REVIEW" : "FAILED",
    live
      ? `Live on ${summary.posted} marketplace${summary.posted === 1 ? "" : "s"}. Receipt email sent after that.`
      : review
        ? "Facebook accepted the listing and is reviewing it. Not publicly live yet, so no email was sent."
        : "Publishing failed. No marketplace listing went live, so no email was sent."
  );
  } finally {
    markAgentIdle(id);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const listing = await getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    price?: number;
    floor_price?: number;
  };
  const price = body.price ?? listing.price;
  const floor = body.floor_price ?? listing.floor_price;
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json(
      { error: "Enter a verified or manual price before going live." },
      { status: 400 }
    );
  }
  if (!Number.isFinite(floor) || floor < 0 || floor > price) {
    return NextResponse.json(
      { error: "Floor price must be between $0 and the listed price." },
      { status: 400 }
    );
  }
  if (listing.platforms.length === 0) {
    return NextResponse.json(
      { error: "Select at least one connected platform before publishing." },
      { status: 400 }
    );
  }

  const statusByPlatform: Partial<Record<Platform, PlatformConnectionStatus>> =
    Object.fromEntries(
      await Promise.all(
        listing.platforms.map(async (platform) => {
          const connection = await getPlatformConnection(DEMO_USER.id, platform);
          return [platform, connection?.status] as const;
        })
      )
    );
  const unpublished = unpublishedMarketplacePlatforms(listing);
  const retrying =
    listing.status === "live" ||
    listing.status === "posting" ||
    listing.status === "error";
  const targets = retrying ? unpublished : listing.platforms;
  const missing = missingConnectedPlatforms(targets, statusByPlatform);
  const ready = targets.filter((platform) => !missing.includes(platform));

  if (listing.status === "ready" || listing.status === "rejected") {
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Connect ${formatPlatformList(missing)} in Accounts before you can approve this listing.`,
        },
        { status: 400 }
      );
    }
  } else if (ready.length === 0) {
    return NextResponse.json(
      {
        error: missing.length
          ? `Connect ${formatPlatformList(missing)} in Accounts, then publish.`
          : "This listing is already live on the selected platforms.",
      },
      { status: 400 }
    );
  }

  if (!inflight.has(id)) {
    await updateListing(id, {
      status: "posting",
      pipeline_stage: "Posting to platforms",
      pipeline_error: null,
      price,
      floor_price: floor,
    });
    await logAgent(
      id,
      "composio",
      "POST",
      `Posting at $${price}. Floor $${floor} stays hidden.`
    );
    inflight.set(
      id,
      finishPosting(id)
        .catch(() => undefined)
        .finally(() => inflight.delete(id))
    );
  }

  const started = (await getListing(id)) as Listing;
  return NextResponse.json(started, { status: 202 });
}
