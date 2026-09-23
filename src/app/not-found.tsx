import Link from "next/link";
import { SoldMark } from "@/components/SoldMark";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-start justify-center px-5 py-16">
      <SoldMark />
      <h1 className="mt-10 text-[1.75rem] font-semibold tracking-[-0.03em] text-ink">
        Page not found
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink/60">
        That link does not match anything in Sold. Head home or open your listings.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Home
        </Link>
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
