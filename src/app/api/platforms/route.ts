import { NextResponse } from "next/server";
import { listConnections } from "@/lib/marketplace/connections";
import { isEphemeralFs } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const includeLive = new URL(req.url).searchParams.get("live") === "1";
  return NextResponse.json({
    hosted: isEphemeralFs(),
    connections: await listConnections({ includeLive }),
  });
}
