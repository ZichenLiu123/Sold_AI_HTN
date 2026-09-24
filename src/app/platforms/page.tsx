import Link from "next/link";
import { PlatformAccounts } from "@/components/PlatformAccounts";
import { SellerProfileCard } from "@/components/SellerProfileCard";
import { isEphemeralFs } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default function PlatformsPage() {
  const hosted = isEphemeralFs();
  return (
    <div className="px-4 py-6">
      <h1 className="display text-[1.75rem] tracking-tight">Accounts</h1>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-grey">
        {hosted
          ? "Log in in the live browser tab that opens. This hosted site cannot open Chrome on a laptop."
          : "Connect US + Canada marketplaces (including Kijiji and Karrot). Sold reuses the browser session — it does not store your password."}
      </p>
      <PlatformAccounts hosted={hosted} />
      <div className="mt-8">
        <SellerProfileCard />
      </div>
      <Link href="/listings" className="btn-secondary mt-8 w-full">
        Back to listings
      </Link>
    </div>
  );
}
