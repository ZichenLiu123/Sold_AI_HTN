"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabBar() {
  const pathname = usePathname() || "";
  const listingsActive =
    pathname === "/listings" || pathname.startsWith("/listings/");

  return (
    <nav className="tab-bar safe-bottom absolute inset-x-0 bottom-0 z-30 border-t border-line">
      <div className="mx-auto grid h-[3.75rem] max-w-md grid-cols-3 items-center px-2">
        <Tab href="/listings" label="Listings" active={listingsActive} />
        <Link href="/new" aria-label="New listing" className="tab-bar__new mx-auto">
          +
        </Link>
        <Tab href="/inbox" label="Inbox" active={pathname.startsWith("/inbox")} />
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
      className={`flex h-full items-center justify-center text-[13px] font-semibold tracking-tight ${
        active ? "text-ink" : "text-grey"
      }`}
    >
      {label}
    </Link>
  );
}
