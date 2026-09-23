import { NextResponse } from "next/server";
import { getSellerProfile, upsertSellerProfile } from "@/lib/db";
import { emptySellerProfile } from "@/lib/profile";
import { apiError, withSeller } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function GET() {
  try {
    return await withSeller(async () =>
      NextResponse.json(await getSellerProfile())
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request) {
  try {
    return await withSeller(async (user) => {
      const body = await req.json().catch(() => ({}));
      const current = await getSellerProfile();
      const saved = await upsertSellerProfile({
        ...emptySellerProfile(user.id),
        ...current,
        name: clean(body.name),
        city: clean(body.city),
        neighborhood: clean(body.neighborhood),
        zip: clean(body.zip),
        pickup_notes: clean(body.pickup_notes),
      });
      return NextResponse.json(saved);
    });
  } catch (error) {
    return apiError(error, "Could not save profile.");
  }
}
