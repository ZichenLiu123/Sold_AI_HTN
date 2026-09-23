import { NextResponse } from "next/server";
import { getSellerProfile, insertListing, listListings, logAgent } from "@/lib/db";
import { sellerPickupLine } from "@/lib/profile";
import type { UserHints } from "@/lib/types";
import { MAX_PHOTOS, saveUploadedPhotos } from "@/lib/uploads";
import { apiError, withSeller } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await withSeller(async () =>
      NextResponse.json({
        user: await getSellerProfile(),
        listings: await listListings(),
      })
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    return await withSeller(async (user) => {
      const form = await req.formData();
      const files = form
        .getAll("photos")
        .filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length === 0) {
        return NextResponse.json(
          { error: "Upload at least one photo." },
          { status: 400 }
        );
      }

      const photos = await saveUploadedPhotos(files.slice(0, MAX_PHOTOS));

      const asking = form.get("asking_price");
      const profile = await getSellerProfile();
      const hints: UserHints = {
        category: String(form.get("category") || "") || undefined,
        condition: String(form.get("condition") || "") || undefined,
        brand: String(form.get("brand") || "") || undefined,
        reason_for_selling: String(form.get("reason_for_selling") || "") || undefined,
        pickup_notes:
          String(form.get("pickup_notes") || "") ||
          sellerPickupLine(profile) ||
          undefined,
        seller_notes: String(form.get("seller_notes") || "") || undefined,
        asking_price: asking ? Number(asking) : undefined,
      };

      const listing = await insertListing({
        id: crypto.randomUUID(),
        user_id: user.id,
        photos,
        title: "",
        description: "",
        price: hints.asking_price || 0,
        floor_price: 0,
        status: "analyzing",
        platforms: [],
        created_at: new Date().toISOString(),
        attributes: null,
        comps: null,
        price_reasoning: "",
        hints,
        auto_post: form.get("auto_post") === "true",
        platform_posts: [],
        pipeline_stage: "Queued",
        pipeline_error: null,
        last_event: null,
      });
      await logAgent(
        listing.id,
        "lister",
        "QUEUED",
        `${photos.length} photo${photos.length === 1 ? "" : "s"} uploaded. Waiting for the Lister Agent.`
      );

      return NextResponse.json(listing);
    });
  } catch (error) {
    return apiError(error, "Could not create listing.");
  }
}
