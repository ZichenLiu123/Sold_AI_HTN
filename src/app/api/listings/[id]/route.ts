import { NextResponse } from "next/server";
import { deleteListing, getListing, listEvents, listMessages, logAgent, updateListing } from "@/lib/db";
import { PLATFORMS } from "@/lib/types";
import type { ItemAttributes, ListingStatus, Platform } from "@/lib/types";
import { hasLiveMarketplace } from "@/lib/marketplace/policy";
import { takedownListing } from "@/lib/agents/takedown";
import {
  clearCancel,
  requestCancel,
  waitUntilAgentIdle,
} from "@/lib/agents/cancel";
import { apiError, withOwnedListing } from "@/lib/api";
import { runAsUserAsync } from "@/lib/seller-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwnedListing(id, async (_user, listing) =>
    NextResponse.json({
      listing,
      messages: await listMessages(id),
      events: await listEvents(id),
    })
  );
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwnedListing(id, async (_user, current) => {
    const body = (await req.json()) as {
      price?: number;
      floor_price?: number;
      title?: string;
      description?: string;
      price_reasoning?: string;
      platforms?: string[];
      photos?: string[];
      attributes?: Partial<ItemAttributes>;
      status?: ListingStatus;
    };

    const platforms = Array.isArray(body.platforms)
      ? body.platforms.filter((p): p is Platform =>
          (PLATFORMS as readonly string[]).includes(p)
        )
      : undefined;

    const attributes = body.attributes
      ? {
          category: current.attributes?.category || "",
          brand: current.attributes?.brand || null,
          model: current.attributes?.model || null,
          condition: current.attributes?.condition || "",
          flaws: current.attributes?.flaws || [],
          color: current.attributes?.color || null,
          notable_features: current.attributes?.notable_features || [],
          visible_text: current.attributes?.visible_text || [],
          confidence: current.attributes?.confidence || "medium",
          ...body.attributes,
        }
      : undefined;

    const listing = await updateListing(id, {
      ...(typeof body.title === "string" ? { title: body.title.slice(0, 80) } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.price_reasoning === "string"
        ? { price_reasoning: body.price_reasoning }
        : {}),
      ...(typeof body.price === "number" ? { price: body.price } : {}),
      ...(typeof body.floor_price === "number" ? { floor_price: body.floor_price } : {}),
      ...(platforms ? { platforms } : {}),
      ...(Array.isArray(body.photos) &&
      current.status !== "live" &&
      current.status !== "sold"
        ? { photos: body.photos }
        : {}),
      ...(attributes ? { attributes } : {}),
      ...(body.status === "rejected" || body.status === "ready"
        ? {
            status: body.status,
            pipeline_stage: body.status === "rejected" ? "Rejected" : current.pipeline_stage,
          }
        : {}),
    });

    if (body.status === "rejected") {
      await logAgent(id, "lister", "REJECT", "Alex rejected the listing. It was not posted.");
    } else if (
      typeof body.title === "string" ||
      typeof body.description === "string" ||
      typeof body.price === "number" ||
      platforms
    ) {
      await logAgent(id, "lister", "EDIT", "Saved your edits here. Not posted.");
    }

    return NextResponse.json(listing);
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwnedListing(id, async (user, listing) => {
    const force = new URL(req.url).searchParams.get("force") === "1";

    requestCancel(id);
    await waitUntilAgentIdle(id);
    clearCancel(id);

    const current = (await getListing(id)) || listing;
    const live =
      hasLiveMarketplace(current) ||
      current.platform_posts.some(
        (post) =>
          post.platform !== "Gmail receipt" &&
          (post.status === "posted" ||
            post.remote_state === "live" ||
            post.remote_state === "review")
      );

    if (force) {
      if (!(await deleteListing(id))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    if (live || current.status === "live" || current.status === "posting") {
      try {
        await runAsUserAsync(user.id, () => takedownListing(current));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not take the listing down.";
        return NextResponse.json(
          {
            error: `Take it down on the marketplace first. ${message}`,
          },
          { status: 409 }
        );
      }
      const latest = await getListing(id);
      if (latest && hasLiveMarketplace(latest)) {
        await updateListing(id, {
          status: "rejected",
          pipeline_stage: "Take down needs another try",
          pipeline_error:
            "Facebook still looks live. Tap Delete forever to remove the ticket here anyway.",
        });
        return NextResponse.json(
          {
            error:
              "Facebook still looks live. Sold kept the ticket. Tap Delete forever to remove it here anyway.",
            listing: await getListing(id),
          },
          { status: 409 }
        );
      }
    }

    if (!(await deleteListing(id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
