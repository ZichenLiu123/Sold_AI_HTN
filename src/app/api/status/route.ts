import { NextResponse } from "next/server";
import { ensureBackgroundFacebookMonitor } from "@/lib/agents/monitor";
import { getSellerProfile } from "@/lib/db";
import { sellerDisplayName } from "@/lib/profile";
import { isEphemeralFs } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  void ensureBackgroundFacebookMonitor();
  return NextResponse.json({
    user: sellerDisplayName(await getSellerProfile()),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    openai_model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-5.4",
    llm: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
    browserbase: Boolean(process.env.BROWSERBASE_API_KEY),
    composio: Boolean(process.env.COMPOSIO_API_KEY),
    composio_email: Boolean(process.env.COMPOSIO_NOTIFY_EMAIL),
    hosted: isEphemeralFs(),
  });
}
