import { NextResponse } from "next/server";
import {
  capturePendingFacebookListings,
  facebookMonitorStatus,
  peekFacebookInbox,
  startFacebookMonitor,
  stopFacebookMonitor,
} from "@/lib/agents/monitor";
import { apiError, withSeller } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(req: Request) {
  try {
    return await withSeller(async () => {
      const peek = new URL(req.url).searchParams.get("peek");
      const capture = new URL(req.url).searchParams.get("capture");
      if (capture) {
        try {
          return NextResponse.json(await capturePendingFacebookListings());
        } catch (error) {
          return NextResponse.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Could not read Facebook Selling.",
            },
            { status: 500 }
          );
        }
      }
      if (peek) {
        try {
          return NextResponse.json(await peekFacebookInbox());
        } catch (error) {
          return NextResponse.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Could not read Facebook inbox.",
              threads: [],
              latest: null,
            },
            { status: 500 }
          );
        }
      }
      return NextResponse.json(facebookMonitorStatus());
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    return await withSeller(async () =>
      NextResponse.json(startFacebookMonitor())
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  try {
    return await withSeller(async () =>
      NextResponse.json(stopFacebookMonitor())
    );
  } catch (error) {
    return apiError(error);
  }
}
