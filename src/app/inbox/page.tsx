import Link from "next/link";
import { conversationsForListing } from "@/lib/conversations";
import { listListings, listMessages } from "@/lib/db";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const listings = await listListings();
  const threads = (
    await Promise.all(
      listings.map(async (listing) => {
        const messages = await listMessages(listing.id);
        const conversations = conversationsForListing(listing.id, messages, {
          includeDemo: true,
        }).filter((conversation) => conversation.last);
        if (conversations.length === 0) return [];
        return [
          {
            listing,
            conversations,
          },
        ];
      })
    )
  )
    .flat()
    .sort((a, b) => {
      const aTime =
        a.conversations[0]?.last?.timestamp || a.listing.created_at;
      const bTime =
        b.conversations[0]?.last?.timestamp || b.listing.created_at;
      return aTime > bTime ? -1 : 1;
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="flex items-end justify-between">
        <h1 className="font-serif text-3xl leading-none">Inbox</h1>
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-sage">
          Demo
        </p>
      </div>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-card">
        {threads.map(({ listing, conversations }) => {
          const latest = conversations.find((thread) => !thread.demo) || conversations[0];
          const extra =
            conversations.filter((thread) => !thread.demo).length > 1
              ? ` · ${conversations.filter((thread) => !thread.demo).length} buyers`
              : "";
          return (
            <li key={listing.id}>
              <Link
                href={`/listings/${listing.id}?chats=1`}
                className="flex items-center gap-3 px-3 py-2.5 active:bg-wash/60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={listing.photos[0]}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-serif text-base leading-tight">
                      {listing.title || "Untitled listing"}
                    </p>
                    <p className="shrink-0 font-mono text-[10px] text-ink/50">
                      {listing.price ? money(listing.price) : ""}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink/55">
                    {latest?.last
                      ? `${latest.buyer_name} · ${latest.last.text}${extra}`
                      : `${latest?.buyer_name || "Demo"} · Practice thread`}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
