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
          ? "Connect each marketplace in the live browser tab that opens. This hosted site cannot open Chrome on your laptop."
          : "Connect US + Canada marketplaces (including Kijiji and Karrot). Sold reuses the browser session and never stores your password."}
      </p>
      <div className="mt-6">
        <PlatformAccounts hosted={hosted} />
      </div>
      <div className="mt-10 border-t border-line pt-8">
        <SellerProfileCard />
      </div>
    </div>
  );
}
