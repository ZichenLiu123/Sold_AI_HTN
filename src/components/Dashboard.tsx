import Link from "next/link";
import { ListingCard } from "./ListingCard";
import type { Listing } from "@/lib/types";

export function Dashboard({ listings = [] }: { listings: Listing[] }) {
  if (listings.length === 0) {
    return (
      <div className="flex min-h-full flex-1 flex-col justify-center px-4 py-12">
        <div className="mx-auto w-full max-w-sm">
          <div
            className="mb-8 flex h-28 items-center justify-center rounded-2xl border border-dashed border-line bg-wash/60"
            aria-hidden
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-paper shadow-sm ring-1 ring-line">
              <span className="text-[1.75rem] leading-none text-ink">+</span>
            </div>
          </div>
          <h1 className="display max-w-[14ch] text-[2rem] tracking-tight">
            Start with a photo
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-grey">
            Sold identifies the item, prices from live comps, writes the listing,
            and waits for your approval before posting. After it&apos;s live,
            reply drafts stay here until you approve what goes out.
          </p>
          <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link href="/new" className="btn-primary w-full sm:w-fit">
              Take a photo
            </Link>
            <Link
              href="/platforms"
              className="btn-secondary w-full text-center sm:w-fit"
            >
              Connect accounts
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const live = listings.filter((listing) => listing.status === "live").length;
  const review = listings.filter((listing) => listing.status === "ready").length;
  const meta = [
    live > 0 ? `${live} live` : null,
    review > 0 ? `${review} need review` : null,
    `${listings.length} total`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="px-4 py-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="display text-[1.75rem] tracking-tight">Listings</h1>
          {meta ? <p className="mt-1.5 text-[13px] text-grey">{meta}</p> : null}
        </div>
        <Link href="/new" className="btn-primary h-9 shrink-0 px-3.5 text-[13px]">
          Take a photo
        </Link>
      </div>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {listings.map((listing) => (
          <li key={listing.id}>
            <ListingCard listing={listing} />
          </li>
        ))}
      </ul>
    </div>
  );
}
