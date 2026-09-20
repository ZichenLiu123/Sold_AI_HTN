"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Status = {
  llm: boolean;
  openai: boolean;
  claude: boolean;
  browserbase: boolean;
  composio: boolean;
};

export function Shell({
  children,
  brand,
}: {
  children: React.ReactNode;
  brand: React.ReactNode;
}) {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <>
      <header className="sold-header safe-top z-20 shrink-0 border-b border-line/80 bg-paper/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          {brand}
          <Link
            href="/platforms"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/55"
          >
            Accounts
          </Link>
        </div>
        {status && !status.llm && (
          <p className="border-t border-line bg-wash px-4 py-2 text-center text-xs text-ink/70">
            Add an OpenAI or Anthropic key to run the agents.
          </p>
        )}
      </header>

      <main className="sold-main flex min-h-0 flex-1 flex-col">{children}</main>
      <TabBar pathname={pathname} />
    </>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav className="tab-bar safe-bottom absolute inset-x-0 bottom-0 z-30 w-full border-t border-line bg-card/95 backdrop-blur">
      <div className="grid grid-cols-3 items-end px-2 pt-2">
        <Tab href="/listings" label="Listings" active={pathname === "/listings"} />
        <Link
          href="/new"
          className="-mt-7 mb-1 flex flex-col items-center justify-center"
        >
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
      className={`flex flex-col items-center pb-2 font-mono text-[10px] uppercase tracking-[0.16em] ${active ? "text-ink" : "text-ink/40"}`}
    >
      <span className={`mb-1 h-1 w-6 rounded-full ${active ? "bg-sold" : "bg-transparent"}`} />
      {label}
    </Link>
  );
}
