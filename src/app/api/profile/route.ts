import { NextResponse } from "next/server";
import { getSellerProfile, upsertSellerProfile } from "@/lib/db";
import { emptySellerProfile } from "@/lib/profile";
import { DEMO_USER } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function GET() {
  return NextResponse.json(await getSellerProfile());
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const current = await getSellerProfile();
  const saved = await upsertSellerProfile({
    ...emptySellerProfile(DEMO_USER.id),
    ...current,
    name: clean(body.name),
    city: clean(body.city),
    neighborhood: clean(body.neighborhood),
    zip: clean(body.zip),
    pickup_notes: clean(body.pickup_notes),
  });
  return NextResponse.json(saved);
}
