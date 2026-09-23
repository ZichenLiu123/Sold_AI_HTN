import { NextResponse } from "next/server";
import { beginConnection } from "@/lib/marketplace/connections";
import { isMarketplacePlatform } from "@/lib/marketplace/adapters";
import { platformFromSlug } from "@/lib/platforms";
import { apiError, withSeller } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
      NextResponse.json(await beginConnection(platform))
    );
  } catch (error) {
    return apiError(error, "Connection failed.");
  }
}
