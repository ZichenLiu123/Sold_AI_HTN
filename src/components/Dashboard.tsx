import Link from "next/link";
import { ListingCard } from "./ListingCard";
import type { Listing } from "@/lib/types";

export function Dashboard({ listings = [] }: { listings: Listing[] }) {
  if (listings.length === 0) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center px-5 text-center">
        <p className="stamp text-sold">empty</p>
        <h1 className="mt-5 font-serif text-[2.6rem] leading-[0.95]">
          No listings yet.
        </h1>
        <p className="mt-4 max-w-xs text-base text-ink/65">
          Photograph something. The Lister writes it, comps it, and the
          Negotiator talks to the buyer.
        </p>
        <Link
          href="/new"
          className="mt-8 flex h-14 w-full max-w-xs items-center justify-center rounded-full bg-sold text-paper"
        >
          Open the camera
        </Link>
      </div>
    );
  }

  const live = listings.filter((listing) => listing.status === "live").length;
  const review = listings.filter((listing) => listing.status === "ready").length;
  const bits = [
    live ? `${live} live` : "",
    review ? `${review} need review` : "",
  ].filter(Boolean);

  return (
    <div className="px-4 py-5">
      <h1 className="font-serif text-4xl leading-none">Listings</h1>
      {bits.length > 0 && (
        <p className="mt-2 text-sm text-ink/55">{bits.join(" · ")}</p>
      )}
      <div className="mt-5 grid gap-4">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </div>
  );
}
