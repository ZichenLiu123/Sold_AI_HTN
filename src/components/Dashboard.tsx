import Link from "next/link";
import { ListingCard } from "./ListingCard";
import type { Listing } from "@/lib/types";

export function Dashboard({ listings = [] }: { listings: Listing[] }) {
  if (listings.length === 0) {
    return (
      <div className="flex min-h-full flex-1 flex-col justify-center px-4 py-12">
        <h1 className="display max-w-[12ch] text-[2rem] tracking-tight">
          Start with a photo
        </h1>
        <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-grey">
          Sold identifies the item, finds comps with real URLs, writes the listing,
          and waits for your approval before posting. After it is live, inbox watch
          drafts replies — you stamp accepts.
        </p>
        <Link href="/new" className="btn-primary mt-8 w-fit">
          Take a photo
        </Link>
      </div>
    );
  }

  const live = listings.filter((listing) => listing.status === "live").length;
  const review = listings.filter((listing) => listing.status === "ready").length;
  const meta = [
    live > 0 ? `${live} live` : null,
    review > 0 ? `${review} need review` : null,
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
