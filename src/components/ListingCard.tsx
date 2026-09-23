import Link from "next/link";
import type { Listing } from "@/lib/types";
import { facebookListingGone } from "@/lib/marketplace/policy";
import { floorCaption, money, statusLabel } from "@/lib/format";
import { statusBadgeClass } from "@/lib/ui";
import { RubberStamp } from "./RubberStamp";

export function ListingCard({ listing }: { listing: Listing }) {
  const photo = listing.photos[0];
  const gone = facebookListingGone(listing);
  const livePost = listing.platform_posts.find(
    (post) => post.status === "posted" && (post.url || post.remote_url)
  );
  const liveUrl = livePost?.url || livePost?.remote_url;
  const stamped = !gone && (listing.status === "live" || listing.status === "sold");

  return (
    <Link
      href={`/listings/${listing.id}`}
      className="grid grid-cols-[4.25rem_1fr] gap-3.5 py-3.5 transition-colors active:bg-wash/70 sm:grid-cols-[5rem_1fr]"
    >
      <div className="aspect-square overflow-hidden rounded-xl bg-wash">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-grey">
            No photo
          </div>
        )}
      </div>
      <div className="min-w-0 self-center">
        <div className="flex flex-wrap items-center gap-1.5">
          {stamped ? (
            <RubberStamp
              label={listing.status === "sold" ? "Sold" : "Live"}
              size="sm"
              rotate={-4}
              className="rubber-stamp--static"
            />
          ) : (
            <span className={`stamp ${statusBadgeClass(listing, gone)}`}>
              {gone ? "Gone" : statusLabel(listing.status)}
            </span>
          )}
          {listing.price > 0 && <span className="price-tag">{money(listing.price)}</span>}
        </div>
        <h2 className="mt-1.5 truncate text-[15px] font-semibold leading-snug tracking-tight text-ink">
          {listing.title || "Reading the photos…"}
        </h2>
        <p className="mt-0.5 truncate text-[13px] text-grey">{floorCaption(listing)}</p>
        {liveUrl ? (
          <p className="mt-1 truncate text-[11px] text-grey">{liveUrl}</p>
        ) : null}
      </div>
    </Link>
  );
}
