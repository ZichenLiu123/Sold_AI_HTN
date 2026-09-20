"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabBar() {
  const pathname = usePathname() || "";

  return (
    <nav className="tab-bar safe-bottom absolute inset-x-0 bottom-0 z-30 w-full border-t border-line bg-card/95 backdrop-blur">
      <div className="grid grid-cols-3 items-end px-2 pt-2">
        <Tab href="/listings" label="Listings" active={pathname === "/listings"} />
        <Link href="/new" className="-mt-7 mb-1 flex flex-col items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sold text-lg text-paper shadow-lg">
            +
          </span>
          <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-sold">
            New
          </span>
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
      className={`flex flex-col items-center pb-2 font-mono text-[10px] uppercase tracking-[0.16em] ${
        active ? "text-ink" : "text-ink/40"
      }`}
    >
      <span className={`mb-1 h-1 w-6 rounded-full ${active ? "bg-sold" : "bg-transparent"}`} />
      {label}
    </Link>
  );
}
