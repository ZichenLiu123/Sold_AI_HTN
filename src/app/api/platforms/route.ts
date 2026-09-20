import { NextResponse } from "next/server";
import { listConnections } from "@/lib/marketplace/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const includeLive = new URL(req.url).searchParams.get("live") === "1";
  return NextResponse.json({
    connections: await listConnections({ includeLive }),
  });
}
