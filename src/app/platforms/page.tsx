import Link from "next/link";
import { PlatformAccounts } from "@/components/PlatformAccounts";
import { isEphemeralFs } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default function PlatformsPage() {
  const hosted = isEphemeralFs();
  return (
    <div className="px-4 py-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">
        seller accounts
      </p>
      <h1 className="mt-1 font-serif text-4xl leading-tight">Connect first.</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/65">
        {hosted
          ? "Log in in the live browser tab that opens. This hosted site cannot open Chrome on a laptop."
          : "Log in once per marketplace. Sold opens the login window, remembers the session, and never stores your password."}
      </p>
      <PlatformAccounts hosted={hosted} />
      <Link
        href="/listings"
        className="mt-6 flex h-14 items-center justify-center rounded-full bg-ink text-paper"
      >
        Back to listings
      </Link>
    </div>
  );
}
