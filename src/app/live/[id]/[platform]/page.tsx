import Link from "next/link";
import { notFound } from "next/navigation";
import { asSellerPage } from "@/lib/api";
import { getListing, getSellerProfile, listingOwnedBySeller } from "@/lib/db";
import { money } from "@/lib/format";
import { listingLocation } from "@/lib/profile";
import { openListingLink, platformFromSlug } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const THEME: Record<
  string,
  { bar: string; name: string; accent: string }
> = {
  facebook: { bar: "bg-[#1877F2] text-white", name: "marketplace", accent: "text-[#1877F2]" },
  kijiji: { bar: "bg-[#373373] text-white", name: "kijiji", accent: "text-[#373373]" },
  offerup: { bar: "bg-[#00A86B] text-white", name: "offerup", accent: "text-[#00A86B]" },
  craigslist: { bar: "bg-[#5B2C83] text-white", name: "craigslist", accent: "text-[#5B2C83]" },
  mercari: { bar: "bg-[#FF0211] text-white", name: "mercari", accent: "text-[#FF0211]" },
  poshmark: { bar: "bg-[#7F0353] text-white", name: "poshmark", accent: "text-[#7F0353]" },
  ebay: { bar: "bg-[#E53238] text-white", name: "ebay", accent: "text-[#E53238]" },
  gmail: { bar: "bg-ink text-paper", name: "gmail receipt", accent: "text-sold" },
};

export default async function LiveListingPage({
  params,
}: {
  params: Promise<{ id: string; platform: string }>;
}) {
  const { id, platform: slug } = await params;
  return asSellerPage(async (user) => {
  const listing = await getListing(id);
  const platform = platformFromSlug(slug);
  if (!listing || !platform || !listingOwnedBySeller(listing, user.id)) notFound();
  const pickup = listingLocation(listing, await getSellerProfile());
  const theme = THEME[slug] || THEME.ebay;
  const posted = listing.platform_posts.find((p) => p.platform === platform);
  const open = posted?.status === "posted"
    ? openListingLink(platform, listing.title, posted.remote_url)
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper" data-listing>
      <div className={`px-4 py-3 ${theme.bar}`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-80">
          preview in sold
        </p>
        <p className="font-serif text-2xl leading-none">{theme.name}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="aspect-[4/3] bg-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={listing.photos[0]}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
        {listing.photos.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {listing.photos.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            ))}
          </div>
        )}
        <div className="px-4 pb-8">
          <p className="mt-3 text-xs text-ink/50">
            {posted?.remote_state === "review"
              ? "Facebook accepted this listing and is reviewing it. It is not publicly live yet."
              : posted?.status === "posted"
                ? posted.detail
                : `This is a Sold preview. It is not a live ${platform} listing.`}
          </p>
          <h1 className="mt-1 font-serif text-3xl leading-tight">{listing.title}</h1>
          <p className={`mt-2 font-mono text-2xl ${theme.accent}`}>
            {money(listing.price)}
          </p>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">
            {listing.description}
          </p>
          {pickup ? <p className="mt-4 text-sm text-ink/55">{pickup}</p> : null}
          <div className="mt-6 grid gap-2">
            {open ? (
              <a
                href={open.href}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 items-center justify-center rounded-full bg-ink text-paper"
              >
                {platform === "Gmail receipt" ? "Open Gmail" : open.label}
              </a>
            ) : posted?.session_url ? (
              <a
                href={posted.session_url}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 items-center justify-center rounded-full bg-ink text-paper"
              >
                Finish in the open session
              </a>
            ) : posted?.status !== "posted" && platform !== "Gmail receipt" ? (
              <Link
                href="/platforms"
                className="flex h-12 items-center justify-center rounded-full bg-ink text-paper"
              >
                Connect {platform}
              </Link>
            ) : null}
            <Link
              href={`/listings/${listing.id}`}
              className="flex h-12 items-center justify-center rounded-full border border-line"
            >
              Back to Sold
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
  });
}
