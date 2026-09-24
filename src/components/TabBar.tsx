"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabBar() {
  const pathname = usePathname() || "";
  const listingsActive =
    pathname === "/listings" || pathname.startsWith("/listings/");
  const accountsActive = pathname.startsWith("/platforms");

  return (
    <nav className="tab-bar safe-bottom absolute inset-x-0 bottom-0 z-30 border-t border-line">
      <div className="mx-auto grid h-[3.75rem] max-w-md grid-cols-4 items-center px-1">
        <Tab href="/listings" label="Listings" active={listingsActive} />
        <Link href="/new" aria-label="New listing" className="tab-bar__new mx-auto">
          +
        </Link>
        <Tab href="/inbox" label="Inbox" active={pathname.startsWith("/inbox")} />
        <Tab href="/platforms" label="Accounts" active={accountsActive} />
      </div>
    </nav>
  );
}

function Tab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex h-full items-center justify-center text-[12px] font-semibold tracking-tight ${
        active ? "text-ink" : "text-grey"
      }`}
    >
      {label}
    </Link>
  );
}
