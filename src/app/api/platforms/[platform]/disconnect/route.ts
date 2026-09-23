import { NextResponse } from "next/server";
import { disconnectConnection } from "@/lib/marketplace/connections";
import { isMarketplacePlatform } from "@/lib/marketplace/adapters";
import { platformFromSlug } from "@/lib/platforms";
import { apiError, withSeller } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ platform: string }> }
) {
  const { platform: slug } = await ctx.params;
  const platform = platformFromSlug(slug);
  if (!platform || !isMarketplacePlatform(platform)) {
    return NextResponse.json({ error: "Unsupported platform." }, { status: 400 });
  }
  try {
    return await withSeller(async () =>
      NextResponse.json(await disconnectConnection(platform))
    );
  } catch (error) {
    return apiError(error, "Could not disconnect.");
  }
}
