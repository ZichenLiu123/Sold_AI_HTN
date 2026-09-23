import Link from "next/link";
import { InboxWatchToggle } from "@/components/InboxWatchToggle";
import { asSellerPage } from "@/lib/api";
import { conversationsForListing } from "@/lib/conversations";
import { ensureDemoInboxes } from "@/lib/demo-inbox";
import { listListings, listMessages } from "@/lib/db";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

function threadState(last: {
  action: string | null;
  escalate: boolean;
  escalate_reason: string;
  sender: string;
} | null) {
  if (!last) return "no messages yet";
  if (last.sender === "agent" && last.action === "accept") {
    return "needs stamp · accept draft";
  }
  if (last.escalate) return "needs you";
  if (last.action) return `draft · ${last.action}`;
  return "waiting";
}

export default async function InboxPage() {
  return asSellerPage(async () => {
    const listings = await listListings();
    await ensureDemoInboxes(listings);
    const threads = (
      await Promise.all(
        listings.map(async (listing) => {
          const messages = await listMessages(listing.id);
          const conversations = conversationsForListing(listing.id, messages, {
            includeDemo: true,
          }).filter((conversation) => conversation.last);
          if (conversations.length === 0) return [];
          return [{ listing, conversations }];
        })
      )
    )
      .flat()
      .sort((a, b) => {
        const aTime = a.conversations[0]?.last?.timestamp || a.listing.created_at;
        const bTime = b.conversations[0]?.last?.timestamp || b.listing.created_at;
        return aTime > bTime ? -1 : 1;
      });

    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <h1 className="display text-[1.75rem] tracking-tight">Inbox</h1>
        <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-grey">
          Sold drafts replies here. Nothing leaves until you stamp — or you reply on
          Facebook yourself.
        </p>
        <InboxWatchToggle />
        {threads.length === 0 ? (
          <div className="mt-10 max-w-sm">
            <p className="text-[16px] font-semibold tracking-tight text-ink">
              No buyer messages yet
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-grey">
              Threads appear when someone writes about a live listing. Facebook is
              monitor-only. Craigslist and eBay get drafts here — Sold does not send
              them.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {threads.map(({ listing, conversations }) => {
              const latest =
                conversations.find((thread) => !thread.demo) || conversations[0];
              const facebookOnly =
                listing.platforms.length === 1 &&
                listing.platforms[0] === "Facebook Marketplace";
              const needsStamp =
                latest?.last?.sender === "agent" &&
                latest.last.action === "accept";
              return (
                <li key={listing.id}>
                  <Link
                    href={`/listings/${listing.id}?chats=1`}
                    className="grid grid-cols-[3.25rem_1fr] gap-3.5 py-3.5 transition-colors active:bg-wash/70"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={listing.photos[0]}
                      alt=""
                      className="aspect-square rounded-xl object-cover"
                    />
                    <div className="min-w-0 self-center">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[15px] font-semibold tracking-tight text-ink">
                          {listing.title || "Untitled listing"}
                        </p>
                        <p className="shrink-0 text-[13px] font-medium text-grey">
                          {listing.price ? money(listing.price) : ""}
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-grey">
                        {latest?.last
                          ? `${latest.buyer_name}: ${latest.last.text}`
                          : `${latest?.buyer_name || "Buyer"}: no messages yet`}
                      </p>
                      <p
                        className={`mt-1 text-[12px] ${
                          needsStamp ? "font-medium text-stamp" : "text-grey"
                        }`}
                      >
                        {threadState(latest?.last || null)}
                        {facebookOnly ? " · facebook monitor-only" : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  });
}
