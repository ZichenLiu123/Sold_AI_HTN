import { NextResponse } from "next/server";
import { deleteListing, getListing, listEvents, listMessages, logAgent, updateListing } from "@/lib/db";
import { PLATFORMS } from "@/lib/types";
import type { ItemAttributes, ListingStatus, Platform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const listing = await getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    listing,
    messages: await listMessages(id),
    events: await listEvents(id),
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const current = await getListing(id);
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!(await deleteListing(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
