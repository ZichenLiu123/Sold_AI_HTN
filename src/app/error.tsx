"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-start justify-center px-5 py-16">
      <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-ink">
        Something went wrong
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink/60">
        Sold hit an unexpected error. Try again, or go back to your listings.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn-primary h-10 px-4 text-[13px]">
          Try again
        </button>
        <Link
          href="/listings"
          className="rounded-full border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-wash"
        >
          Listings
        </Link>
      </div>
    </main>
  );
}
