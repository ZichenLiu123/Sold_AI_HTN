import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const WAITLIST_PATH = path.join(process.cwd(), "data", "waitlist.json");

type WaitlistEntry = { email: string; created_at: string };

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function readEntries(): Promise<WaitlistEntry[]> {
  try {
    const raw = await readFile(WAITLIST_PATH, "utf8");
    const parsed = JSON.parse(raw) as WaitlistEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const email = normalizeEmail(
    body && typeof body === "object" && "email" in body
      ? (body as { email: unknown }).email
      : null
  );
  if (!email) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const entries = await readEntries();
  if (!entries.some((row) => row.email === email)) {
    entries.push({ email, created_at: new Date().toISOString() });
    await mkdir(path.dirname(WAITLIST_PATH), { recursive: true });
    await writeFile(WAITLIST_PATH, JSON.stringify(entries, null, 2) + "\n", "utf8");
  }

  return Response.json({ ok: true });
}
