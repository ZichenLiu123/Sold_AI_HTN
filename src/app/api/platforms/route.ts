import { NextResponse } from "next/server";
import { listConnections } from "@/lib/marketplace/connections";
import { remoteMinutesExhausted } from "@/lib/marketplace/browserbase";
import { isEphemeralFs } from "@/lib/storage";
import { apiError, withSeller } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const includeLive = new URL(req.url).searchParams.get("live") === "1";
    return await withSeller(async () =>
      NextResponse.json({
        hosted: isEphemeralFs(),
        remote_minutes_exhausted: remoteMinutesExhausted(),
        connections: await listConnections({ includeLive }),
      })
    );
  } catch (error) {
    return apiError(error, "Could not load accounts.");
  }
}
