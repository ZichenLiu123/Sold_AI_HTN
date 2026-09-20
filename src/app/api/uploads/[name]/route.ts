import path from "node:path";
import { NextResponse } from "next/server";
import { readPhotoBytes } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ error: "Invalid file." }, { status: 400 });
  }
  try {
    const body = await readPhotoBytes(name);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": TYPES[path.extname(name).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Missing photo." }, { status: 404 });
  }
}
