import { NextResponse } from "next/server";
import { ensureLiveLogin } from "@/lib/marketplace/connections";
import { isMarketplacePlatform } from "@/lib/marketplace/adapters";
import { platformFromSlug } from "@/lib/platforms";

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
    const liveUrl = await ensureLiveLogin(platform, { fresh });
    return NextResponse.redirect(liveUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Browserbase could not open a login browser.";
    return new NextResponse(
      `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${platform} login</title>
  </head>
  <body style="margin:0;background:#f6f1e8;color:#1c1917;font:16px/1.45 ui-sans-serif,system-ui,sans-serif">
    <main style="max-width:28rem;margin:20vh auto;padding:0 1.5rem">
      <p style="letter-spacing:.18em;text-transform:uppercase;font:11px ui-monospace,monospace;opacity:.5">Sold</p>
      <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:500">Browserbase didn’t open login</h1>
      <p style="opacity:.7">${message}</p>
      <p style="margin-top:1.25rem">
        <a href="/platforms" style="display:inline-block;background:#1c1917;color:#f6f1e8;text-decoration:none;border-radius:999px;padding:.75rem 1.1rem;font-size:.85rem">Back to accounts</a>
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
