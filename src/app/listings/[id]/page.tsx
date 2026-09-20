import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ListingDesk } from "@/components/ListingDesk";
import { getListing, listEvents, listMessages } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();
  return (
    <Suspense fallback={<p className="px-4 py-8 text-ink/60">Pulling the ticket…</p>}>
      <ListingDesk
        id={id}
        initialListing={listing}
        initialMessages={await listMessages(id)}
        initialEvents={await listEvents(id)}
      />
    </Suspense>
  );
}
