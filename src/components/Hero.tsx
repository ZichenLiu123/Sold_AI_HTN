import Link from "next/link";

export function Hero() {
  return (
    <div
      data-hero
      className="flex min-h-full flex-1 flex-col justify-center px-6 pb-8"
    >
      <div className="h-[3px] w-full border-y border-ink/70" />
      <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-sold">
        Facebook · Craigslist · eBay
      </p>
      <h1 className="mt-4 max-w-[11ch] font-serif text-[3.15rem] leading-[0.9] tracking-tight">
        From a photo to a live listing.
      </h1>
      <p className="mt-5 max-w-[22rem] text-[1.05rem] leading-snug text-ink/65">
        Snap a photo. Agents write it, price it, post it, and answer the buyer.
      </p>
      <Link
        href="/listings"
        className="mt-8 flex h-14 w-full max-w-xs items-center justify-center rounded-full bg-sold text-paper"
      >
        Open the demo
      </Link>
    </div>
  );
}
