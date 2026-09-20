import { NextResponse } from "next/server";
import { checkConnection } from "@/lib/marketplace/connections";
import { isMarketplacePlatform } from "@/lib/marketplace/adapters";
import { platformFromSlug } from "@/lib/platforms";

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
    return NextResponse.json(await checkConnection(platform));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Login check failed." },
      { status: 502 }
    );
  }
}
