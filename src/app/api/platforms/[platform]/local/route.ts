import { NextResponse } from "next/server";
import { beginLocalConnection } from "@/lib/marketplace/connections";
import { isMarketplacePlatform } from "@/lib/marketplace/adapters";
import { platformFromSlug } from "@/lib/platforms";
import { isEphemeralFs } from "@/lib/storage";
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
  if (isEphemeralFs()) {
    return NextResponse.json(
      {
        error:
          "This hosted site cannot open Chrome on a laptop. Use the live browser login instead.",
      },
      { status: 409 }
    );
  }
  try {
    return await withSeller(async () =>
      NextResponse.json(await beginLocalConnection(platform))
    );
  } catch (error) {
    return apiError(error, "Could not open Chrome on this Mac.");
  }
}
