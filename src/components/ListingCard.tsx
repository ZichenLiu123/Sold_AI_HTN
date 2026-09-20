import Link from "next/link";
import type { Listing } from "@/lib/types";
import { facebookListingGone } from "@/lib/marketplace/policy";
import { floorCaption, money, statusLabel } from "@/lib/format";

export function ListingCard({ listing }: { listing: Listing }) {
  const photo = listing.photos[0];
  return (
    <Link href={`/listings/${listing.id}`} className="block overflow-hidden rounded-2xl bg-card">
      <div className="relative aspect-[4/3] bg-wash">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink/40">
            no photo
          </div>
        )}
        <span
          className={`stamp absolute right-3 top-3 bg-card/90 ${listing.status === "sold" || listing.status === "rejected" || facebookListingGone(listing) ? "text-sold" : listing.status === "live" ? "text-sage" : "text-ink/70"}`}
        >
          {facebookListingGone(listing) ? "Gone" : statusLabel(listing.status)}
        </span>
        {listing.price > 0 && (
          <span className="absolute bottom-3 left-3 rounded-full bg-ink px-3 py-1 font-mono text-sm text-paper">
            {money(listing.price)}
          </span>
        )}
      </div>
      <div className="px-4 py-3">
        <h2 className="font-serif text-xl leading-tight">
          {listing.title || "Still looking at the photo…"}
        </h2>
        <p className="mt-1 truncate text-sm text-ink/55">{floorCaption(listing)}</p>
      </div>
    </Link>
  );
}
