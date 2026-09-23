import { NextResponse } from "next/server";
import { logAgent, updateListing } from "@/lib/db";
import { MAX_PHOTOS, saveUploadedPhotos } from "@/lib/uploads";
import { withOwnedListing } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withOwnedListing(id, async (_user, listing) => {
    if (listing.status === "live" || listing.status === "sold") {
      return NextResponse.json(
        { error: "Photos on a live listing stay as they were posted." },
        { status: 409 }
      );
    }

    const form = await req.formData();
    const files = form
      .getAll("photos")
      .filter((f): f is File => f instanceof File && f.size > 0);
    const room = Math.max(0, MAX_PHOTOS - listing.photos.length);
    if (room === 0) {
      return NextResponse.json(
        { error: `Already at ${MAX_PHOTOS} photos.` },
        { status: 400 }
      );
    }

    const added = await saveUploadedPhotos(files.slice(0, room));
    const next = await updateListing(id, {
      photos: [...listing.photos, ...added],
    });
    await logAgent(
      id,
      "lister",
      "PHOTOS",
      `Added ${added.length} photo${added.length === 1 ? "" : "s"}.`
    );
    return NextResponse.json(next);
  });
}
