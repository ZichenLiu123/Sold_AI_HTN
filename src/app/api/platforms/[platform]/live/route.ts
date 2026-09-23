import { NextResponse } from "next/server";
import { ensureLiveLogin } from "@/lib/marketplace/connections";
import { isMarketplacePlatform } from "@/lib/marketplace/adapters";
import { platformFromSlug } from "@/lib/platforms";
import { withSeller } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ platform: string }> }
) {
  const { platform: slug } = await ctx.params;
  const platform = platformFromSlug(slug);
  if (!platform || !isMarketplacePlatform(platform)) {
    return NextResponse.json({ error: "Unsupported platform." }, { status: 400 });
  }
  try {
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const liveUrl = await withSeller(async () =>
      ensureLiveLogin(platform, { fresh })
    );
    return NextResponse.redirect(liveUrl);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Browserbase could not open a login browser.";
    return new NextResponse(
      `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${platform} login</title>
  </head>
  <body style="margin:0;background:#ffffff;color:#0a0a0a;font:16px/1.5 ui-sans-serif,system-ui,sans-serif">
    <main style="max-width:28rem;margin:20vh auto;padding:0 1.5rem">
      <p style="font-weight:700;letter-spacing:-0.04em">Sold</p>
      <h1 style="font-size:1.75rem;font-weight:700;letter-spacing:-0.035em;margin:1rem 0 0.75rem">Couldn’t open login</h1>
      <p style="color:#71717a">${message}</p>
      <p style="margin-top:1.5rem">
        <a href="/platforms" style="display:inline-flex;align-items:center;justify-content:center;height:2.75rem;padding:0 1.125rem;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:0.5rem;font-size:0.9375rem;font-weight:600">Back to accounts</a>
      </p>
    </main>
  </body>
</html>`,
      {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      }
    );
  }
}
