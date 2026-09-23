"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, Listing, Message, NegotiatorAction, Platform, PlatformConnectionStatus } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { ActionStamp, money, statusLabel } from "@/lib/format";
import {
  facebookListingGone,
  facebookListingReview,
  formatPlatformList,
  hasLiveMarketplace,
  listingChatReady,
  listingPublishStalled,
  missingConnectedPlatforms,
  unpublishedMarketplacePlatforms,
} from "@/lib/marketplace/policy";
import {
  DEMO_BUYER_NAME,
  conversationById,
  conversationsForListing,
  demoConversationId,
} from "@/lib/conversations";
import { openListingLink } from "@/lib/platforms";
import { PhotoTray } from "./PhotoTray";
import { RubberStamp } from "./RubberStamp";

type ListingEdits = {
  title: string;
  description: string;
  price: number;
  floor_price: number;
  platforms: Platform[];
  attributes: {
    brand: string;
    category: string;
    condition: string;
    model: string;
  };
};

export function ListingDesk({
  id,
  initialListing,
  initialMessages,
  initialEvents,
}: {
  id: string;
  initialListing: Listing;
  initialMessages: Message[];
  initialEvents: AgentEvent[];
}) {
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(initialListing);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
  const [draft, setDraft] = useState("");
  const [sender, setSender] = useState<"buyer" | "human">("buyer");
  const [busy, setBusy] = useState("");
  const [revising, setRevising] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [watchOn, setWatchOn] = useState(true);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<"none" | "activity" | "ticket">("none");
  const [connectionStatus, setConnectionStatus] = useState<
    Partial<Record<Platform, PlatformConnectionStatus>>
  >({});
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const ran = useRef(false);
  const posted = useRef(false);
  const poll = useRef<number | undefined>(undefined);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const searchParams = useSearchParams();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [showChats, setShowChats] = useState(false);

  useEffect(() => {
    setThreadId(searchParams.get("thread"));
    setShowChats(searchParams.get("chats") === "1");
  }, [id, searchParams]);

  const refreshConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/platforms", { cache: "no-store" });
      const data = await res.json();
      setConnectionStatus(
        Object.fromEntries(
          (data.connections || []).map(
            (connection: { platform: Platform; status: PlatformConnectionStatus }) => [
              connection.platform,
              connection.status,
            ]
          )
        )
      );
    } catch {
      /* keep last known status */
    } finally {
      setConnectionsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshConnections();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshConnections();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshConnections]);

  async function refresh(): Promise<Listing | null> {
    const res = await fetch(`/api/listings/${id}`);
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) {
      router.replace("/listings");
      return null;
    }
    if (!res.ok) throw new Error(data.error || "Missing listing");
    setListing(data.listing);
    setMessages(data.messages || []);
    setEvents(data.events || []);
    return data.listing as Listing;
  }

  async function pollUntilPosted() {
    const started = Date.now();
    while (Date.now() - started < 300_000) {
      const current = await refresh();
      if (!current) return null;
      if (current.status !== "posting") return current;
      if (facebookListingReview(current)) return current;
      if (current.pipeline_error) return current;
      if (/^stopped/i.test(current.pipeline_stage || "")) return current;
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    return refresh();
  }

  async function runLister(force = false) {
    setBusy("lister");
    setError("");
    const terminal = new Set(["ready", "error", "live", "sold", "rejected"]);
    const pollUntilDone = async () => {
      const started = Date.now();
      while (Date.now() - started < 180_000) {
        const current = await refresh();
        if (!current) return;
        if (/^stopped/i.test(current.pipeline_stage || "")) {
          return current;
        }
        if (
          terminal.has(current.status) &&
          (current.title || current.status === "error" || current.pipeline_error)
        ) {
          return current;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      throw new Error("Lister is still running. Refresh in a moment.");
    };
    try {
      const posted = fetch(`/api/listings/${id}/run${force ? "?force=1" : ""}`, {
        method: "POST",
      });
      const polled = pollUntilDone();
      const res = await posted;
      if (res.status === 202) {
        await polled;
        return;
      }
      const data = await res.json();
      if (!res.ok) setError(data.error || "Lister failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lister failed");
      await refresh().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await refresh();
        if (!current || cancelled) return;
        if (
          !ran.current &&
          (current.status === "analyzing" || current.status === "draft") &&
          !current.title
        ) {
          ran.current = true;
          await runLister(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load listing");
        }
      }
    })();
    return () => {
      cancelled = true;
      const pollId = poll.current;
      if (pollId) window.clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!listing || posted.current || !connectionsLoaded) return;
    if (listing.auto_post && listing.status === "ready" && listing.price > 0) {
      if (
        listing.platforms.length === 0 ||
        missingConnectedPlatforms(listing.platforms, connectionStatus).length > 0
      ) {
        return;
      }
      posted.current = true;
      void approve({
        title: listing.title,
        description: listing.description,
        price: listing.price,
        floor_price: listing.floor_price,
        platforms: listing.platforms,
        attributes: {
          brand: listing.attributes?.brand || "",
          category: listing.attributes?.category || "",
          condition: listing.attributes?.condition || "",
          model: listing.attributes?.model || "",
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.status, listing?.auto_post, connectionsLoaded, connectionStatus]);

  useEffect(() => {
    const node = chatEnd.current;
    const scroller = node?.parentElement;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
  }, [messages.length, events.length, busy]);

  const facebookLive = Boolean(
    listing?.platform_posts.some(
      (post) =>
        post.platform === "Facebook Marketplace" &&
        post.status === "posted" &&
        post.remote_state !== "review"
    )
  );

  useEffect(() => {
    fetch("/api/monitor/facebook", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setWatchOn(data.enabled !== false))
      .catch(() => undefined);
  }, [listing?.id]);

  useEffect(() => {
    if (!listing || !watchOn) return;
    const watching =
      listingChatReady(listing) || facebookListingReview(listing);
    if (!watching) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, listing?.status, facebookLive, watchOn]);

  useEffect(() => {
    if (!listing) return;
    const streaming =
      stopping ||
      (listing.status === "posting" && !facebookListingReview(listing)) ||
      listing.status === "analyzing" ||
      busy === "post" ||
      busy === "lister";
    if (!streaming) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, listing?.status, busy]);

  const chips = useMemo(() => {
    if (!listing?.price) return [];
    const low = Math.max(5, Math.round(listing.price * 0.45));
    const mid = Math.round(listing.price * 0.88);
    return [
      "Still available?",
      "Any flaws?",
      `Would you take $${low}?`,
      `$${mid} cash today.`,
      `I'll take it at $${listing.price}.`,
      "Venmo extra, refund shipping after.",
    ];
  }, [listing]);

  async function approve(edits: ListingEdits) {
    if (!Number.isFinite(edits.price) || edits.price <= 0) {
      setError("Enter a price before going live.");
      return;
    }
    if (!Number.isFinite(edits.floor_price) || edits.floor_price < 0) {
      setError("Enter a valid floor price.");
      return;
    }
    if (edits.platforms.length === 0) {
      setError("Select a connected platform before approving.");
      return;
    }
    const missing = missingConnectedPlatforms(edits.platforms, connectionStatus);
    if (missing.length > 0) {
      setError(
        `Connect ${formatPlatformList(missing)} in Accounts before you can approve.`
      );
      return;
    }
    const patchedOk = await saveDraft(edits);
    if (!patchedOk) return;
    setBusy("post");
    setError("");
    const res = await fetch(`/api/listings/${id}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        price: edits.price,
        floor_price: edits.floor_price,
      }),
    });
    if (res.status === 202) {
      await pollUntilPosted();
      setBusy("");
      return;
    }
    const data = await res.json();
    if (!res.ok) setError(data.error || "Post failed");
    await refresh();
    setBusy("");
  }

  async function saveDraft(edits: ListingEdits) {
    setBusy("save");
    setError("");
    const patched = await fetch(`/api/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: edits.title,
        description: edits.description,
        ...(Number.isFinite(edits.price) ? { price: edits.price } : {}),
        ...(Number.isFinite(edits.floor_price) && edits.floor_price >= 0
          ? { floor_price: edits.floor_price }
          : {}),
        platforms: edits.platforms,
        attributes: {
          brand: edits.attributes.brand || null,
          category: edits.attributes.category,
          condition: edits.attributes.condition,
          model: edits.attributes.model || null,
        },
      }),
    });
    const patchData = await patched.json();
    if (!patched.ok) {
      setError(patchData.error || "Could not save edits");
      setBusy("");
      return false;
    }
    if (patchData.id) setListing(patchData);
    else await refresh();
    setBusy("");
    return true;
  }

  async function resumePosting() {
    setBusy("post");
    setError("");
    const res = await fetch(`/api/listings/${id}/post`, { method: "POST" });
    if (res.status === 202) {
      await pollUntilPosted();
      setBusy("");
      return;
    }
    const data = await res.json();
    if (!res.ok) setError(data.error || "Could not resume posting");
    await refresh();
    setBusy("");
  }

  async function stopAgent() {
    if (!listing || stopping) return;
    setStopping(true);
    setBusy(listing.status === "analyzing" ? "lister" : listing.status === "posting" ? "post" : busy);
    try {
      const res = await fetch(`/api/listings/${id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not stop the agent");
        setStopping(false);
        return;
      }
      setListing(data);
    } catch {
      setError("Could not stop the agent");
      setStopping(false);
      return;
    }
    if (listing.status === "posting") await pollUntilPosted();
    else {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const next = await refresh();
        if (next && !["analyzing", "posting"].includes(next.status) && !/stopping/i.test(next.pipeline_stage || "")) {
          break;
        }
      }
    }
    setStopping(false);
    setBusy("");
  }

  async function addPhotos(files: File[]) {
    if (files.length === 0) return;
    if (listing?.status === "live" || listing?.status === "sold") return;
    const form = new FormData();
    for (const file of files) form.append("photos", file);
    const res = await fetch(`/api/listings/${id}/photos`, {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not add photos");
      return;
    }
    setListing(data);
  }

  async function rejectListing() {
    setBusy("reject");
    setError("");
    const res = await fetch(`/api/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not reject listing");
      setBusy("");
      return;
    }
    router.push("/listings");
  }

  async function restoreListing() {
    setBusy("restore");
    const res = await fetch(`/api/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ready" }),
    });
    const data = await res.json();
    if (res.ok) setListing(data);
    setBusy("");
  }

  async function discardListing(force = false) {
    setBusy("takedown");
    setError("");
    const res = await fetch(`/api/listings/${id}${force ? "?force=1" : ""}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not delete listing");
      if (data.listing) setListing(data.listing);
      setBusy("");
      return;
    }
    router.push("/listings");
  }

  async function removePhoto(src: string) {
    if (!listing || listing.photos.length < 2) return;
    if (listing.status === "live" || listing.status === "sold") return;
    const res = await fetch(`/api/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photos: listing.photos.filter((photo) => photo !== src),
      }),
    });
    const data = await res.json();
    if (res.ok) setListing(data);
  }

  async function send(text = draft) {
    if (!text.trim()) return;
    setBusy("chat");
    setError("");
    setDraft("");
    const conversationId = threadId || demoConversationId(id);
    const buyerName =
      conversationById(id, messages, conversationId)?.buyer_name || DEMO_BUYER_NAME;
    const res = await fetch(`/api/listings/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        sender,
        conversation_id: conversationId,
        buyer_name: buyerName,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Message failed");
      setDraft(text);
    } else {
      setListing(data.listing);
      setMessages(data.messages);
      if (data.events) setEvents(data.events);
    }
    setBusy("");
  }

  async function stampAccept(messageId: string) {
    setBusy("stamp");
    setError("");
    const res = await fetch(`/api/listings/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stamp_message_id: messageId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Stamp failed");
    } else {
      setListing(data.listing);
      setMessages(data.messages);
      if (data.events) setEvents(data.events);
    }
    setBusy("");
  }

  if (!listing && error) {
    return <p className="px-4 py-8 text-sold">{error}</p>;
  }
  if (!listing) {
    return <p className="px-4 py-8 text-ink/60">Pulling the ticket…</p>;
  }

  const chatReady = listingChatReady(listing);
  const publishStalled = listingPublishStalled(listing);
  const facebookGone = facebookListingGone(listing);
  const facebookReview = facebookListingReview(listing);
  const threads = conversationsForListing(id, messages, { includeDemo: chatReady });
  const active = conversationById(id, messages, threadId);

  function openThread(conversationId: string) {
    setThreadId(conversationId);
    router.replace(`/listings/${id}?thread=${encodeURIComponent(conversationId)}`);
  }

  function openChats() {
    setThreadId(null);
    setShowChats(true);
    router.replace(`/listings/${id}?chats=1`);
  }

  function closeThread() {
    setThreadId(null);
    setShowChats(true);
    router.replace(`/listings/${id}?chats=1`);
  }

  function closeChats() {
    setThreadId(null);
    setShowChats(false);
    router.replace(`/listings/${id}`);
  }
  const stamp = listing.status === "sold"
    ? "sold"
    : facebookGone
      ? "gone"
      : chatReady
      ? "live"
      : facebookReview
        ? "review"
      : publishStalled
        ? "failed"
        : listing.status;
  const agentRunning =
    stopping ||
    revising ||
    listing.status === "analyzing" ||
    (listing.status === "posting" &&
      !facebookReview &&
      !/^stopped/i.test(listing.pipeline_stage || "")) ||
    busy === "post" ||
    busy === "lister" ||
    /^taking down live/i.test(listing.pipeline_stage || "") ||
    /^updating live/i.test(listing.pipeline_stage || "") ||
    /^updating (facebook|craigslist|ebay)/i.test(listing.pipeline_stage || "") ||
    /^still opening /i.test(listing.pipeline_stage || "");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden" data-listing>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-paper px-3 py-2.5">
        {chatReady && threadId ? (
          <button
            type="button"
            onClick={closeThread}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wash text-base text-ink"
            aria-label="Back to chats"
          >
            ←
          </button>
        ) : chatReady && showChats ? (
          <button
            type="button"
            onClick={closeChats}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wash text-base text-ink"
            aria-label="Back to listing"
          >
            ←
          </button>
        ) : (
          <Link
            href="/listings"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wash text-base text-ink"
            aria-label="Back to listings"
          >
            ←
          </Link>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listing.photos[0]}
          alt=""
          className="h-8 w-8 shrink-0 rounded-lg object-cover"
        />
        <button
          type="button"
          onClick={() => setSheet("ticket")}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-[14px] font-semibold leading-tight tracking-tight">
            {listing.title || "Looking at the photos…"}
          </p>
          <p className="text-[11px] text-grey">
            {listing.price ? money(listing.price) : statusLabel(listing.status)}
            {active ? ` · ${active.buyer_name}` : showChats ? " · chats" : ""}
          </p>
        </button>
        {agentRunning && (
          <button
            type="button"
            onClick={() => void stopAgent()}
            disabled={stopping}
            className="shrink-0 px-2 py-1 text-[12px] font-medium text-stamp"
          >
            {stopping || /stopping/i.test(listing.pipeline_stage || "") ? "Stopping…" : "Stop"}
          </button>
        )}
        <span
          className={`stamp shrink-0 ${
            stamp === "sold" || stamp === "gone" || stamp === "failed"
              ? "badge-live"
              : stamp === "live"
                ? "badge-live"
                : stamp === "review"
                  ? "badge-submitted"
                  : "badge-draft"
          }`}
        >
          {stamp === "failed"
            ? "Failed"
            : stamp === "gone"
              ? "Gone"
              : stamp === "review"
                ? "In review"
                : /taken down/i.test(listing.pipeline_stage || "")
                  ? "Down"
                  : statusLabel(listing.status)}
        </span>
      </div>

      {chatReady && active ? (
        <ChatView
          buyerName={active.buyer_name}
          messages={active.messages}
          events={events}
          chips={chips}
          sender={sender}
          setSender={setSender}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          error={error}
          send={send}
          stampAccept={stampAccept}
          listingSold={listing.status === "sold"}
          chatEnd={chatEnd}
          onActivity={() => setSheet("activity")}
          watchingFacebook={watchOn && facebookLive && !facebookGone}
          facebookGone={facebookGone}
        />
      ) : chatReady && showChats ? (
        <ThreadList
          listing={listing}
          threads={threads}
          onOpen={openThread}
          facebookGone={facebookGone}
        />
      ) : chatReady ? (
        <LiveListingView
          listing={listing}
          events={events}
          threads={threads}
          connectionStatus={connectionStatus}
          busy={busy || (revising ? "revise" : "")}
          facebookGone={facebookGone}
          onResume={() => void resumePosting()}
          onRefresh={refresh}
          onRevised={(next) => setListing(next)}
          onWorking={setRevising}
          onOpenChats={openChats}
          onStop={() => void stopAgent()}
          stopping={stopping}
        />
      ) : facebookReview ? (
        <FacebookReviewNotice
          listing={listing}
          connectionStatus={connectionStatus}
          busy={busy}
          onResume={() => void resumePosting()}
        />
      ) : listing.status === "posting" ? (
        <PostingProgress
          listing={listing}
          events={events}
          connectionStatus={connectionStatus}
          busy={busy}
          stopping={stopping}
          onStop={() => void stopAgent()}
        />
      ) : publishStalled ? (
        <UnfinishedPost
          listing={listing}
          events={events}
          connectionStatus={connectionStatus}
          busy={busy}
          error={error}
          stopping={stopping}
          onResume={() => void resumePosting()}
          onDiscard={discardListing}
          onStop={() => void stopAgent()}
        />
      ) : (
        <ReviewView
          listing={listing}
          events={events}
          busy={busy}
          error={error}
          connectionStatus={connectionStatus}
          connectionsLoaded={connectionsLoaded}
          approve={approve}
          saveDraft={saveDraft}
          reject={rejectListing}
          restore={restoreListing}
          discard={discardListing}
          runLister={() => void runLister(true)}
          addPhotos={addPhotos}
          removePhoto={removePhoto}
          onStop={() => void stopAgent()}
          stopping={stopping}
        />
      )}

      {sheet !== "none" && (
        <Sheet onClose={() => setSheet("none")}>
          {sheet === "activity" ? (
            <ActivityList events={events} busy={busy} />
          ) : (
            <Ticket
              listing={listing}
              connectionStatus={connectionStatus}
              onResume={() => void resumePosting()}
              busy={busy}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}

function ReviewView({
  listing,
  events,
  busy,
  error,
  connectionStatus,
  connectionsLoaded,
  approve,
  saveDraft,
  reject,
  restore,
  discard,
  runLister,
  addPhotos,
  removePhoto,
  onStop,
  stopping,
}: {
  listing: Listing;
  events: AgentEvent[];
  busy: string;
  error: string;
  connectionStatus: Partial<Record<Platform, PlatformConnectionStatus>>;
  connectionsLoaded: boolean;
  approve: (edits: ListingEdits) => void;
  saveDraft: (edits: ListingEdits) => Promise<boolean>;
  reject: () => void;
  restore: () => void;
  discard: (force?: boolean) => void;
  runLister: () => void;
  addPhotos: (files: File[]) => void;
  removePhoto: (src: string) => void;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const editable =
    listing.status === "ready" ||
    listing.status === "rejected" ||
    listing.status === "error";
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [priceText, setPriceText] = useState(
    listing.price > 0 ? String(listing.price) : ""
  );
  const [floorText, setFloorText] = useState(
    listing.floor_price > 0 ? String(listing.floor_price) : ""
  );
  const [brand, setBrand] = useState(listing.attributes?.brand || "");
  const [category, setCategory] = useState(listing.attributes?.category || "");
  const [condition, setCondition] = useState(listing.attributes?.condition || "");
  const [model, setModel] = useState(listing.attributes?.model || "");
  const [platforms, setPlatforms] = useState<Platform[]>(listing.platforms);

  useEffect(() => {
    setTitle(listing.title);
    setDescription(listing.description);
    setPriceText(listing.price > 0 ? String(listing.price) : "");
    setFloorText(listing.floor_price > 0 ? String(listing.floor_price) : "");
    setBrand(listing.attributes?.brand || "");
    setCategory(listing.attributes?.category || "");
    setCondition(listing.attributes?.condition || "");
    setModel(listing.attributes?.model || "");
    setPlatforms(listing.platforms);
  }, [
    listing.id,
    listing.status,
    listing.title,
    listing.description,
    listing.price,
    listing.floor_price,
    listing.attributes,
    listing.platforms,
  ]);

  const verifiedComps = Boolean(
    listing.comps &&
      !listing.comps.mocked &&
      listing.comps.comps.length >= 3 &&
      listing.comps.median
  );
  const price = Number(priceText);
  const floor = Number(floorText);
  const missingAccounts = missingConnectedPlatforms(platforms, connectionStatus);
  const canApprove =
    connectionsLoaded &&
    Number.isFinite(price) &&
    price > 0 &&
    platforms.length > 0 &&
    missingAccounts.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        <div className="px-4 pt-4">
          <PhotoTray
            photos={listing.photos}
            onRemove={removePhoto}
            onAdd={addPhotos}
          />
        </div>
        <div className="px-4 py-4">
          <Pipeline listing={listing} busy={busy === "lister"} />
          <StatusManifest listing={listing} />

          {editable ? (
            <div className="mt-5 grid gap-4">
              <div className="grid gap-4 border border-line bg-card p-4 sm:grid-cols-[7rem_1fr]">
                {listing.photos[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={listing.photos[0]}
                    alt=""
                    className="aspect-square w-full object-cover"
                  />
                )}
                <div className="grid gap-3">
                  <p className="text-[13px] font-medium text-grey">
                    Item details
                  </p>
                  <label className="grid gap-1 text-[13px] font-medium text-grey">
                    Brand
                    <input
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      className="h-11 border border-line bg-paper px-3 text-[15px] font-normal text-ink"
                    />
                  </label>
                  <label className="grid gap-1 text-[13px] font-medium text-grey">
                    Model
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="h-11 border border-line bg-paper px-3 text-[15px] font-normal text-ink"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 text-[13px] font-medium text-grey">
                      Condition
                      <select
                        value={condition}
                        onChange={(e) => setCondition(e.target.value)}
                        className="h-11 border border-line bg-paper px-3 text-[15px] text-ink"
                      >
                        <option value="">From photo</option>
                        <option>new</option>
                        <option>like new</option>
                        <option>good</option>
                        <option>fair</option>
                        <option>poor</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-[13px] font-medium text-grey">
                      Category
                      <input
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="h-11 border border-line bg-paper px-3 text-[15px] font-normal text-ink"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <label className="grid gap-1 text-[13px] font-medium text-grey">
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-11 border border-line bg-paper px-3 text-[15px] font-normal text-ink"
                />
              </label>
              <label className="grid gap-1 text-[13px] font-medium text-grey">
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="border border-line bg-paper px-3 py-2 text-[15px] text-ink"
                />
              </label>
              <div>
                <p className="mb-2 text-[13px] font-medium text-grey">Post to</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {PLATFORMS.map((platform) => (
                    <label
                      key={platform}
                      className="flex items-center gap-2 border border-line bg-card px-3 py-2.5 text-[14px]"
                    >
                      <input
                        type="checkbox"
                        className="accent-ledger"
                        checked={platforms.includes(platform)}
                        onChange={(e) =>
                          setPlatforms((current) =>
                            e.target.checked
                              ? [...current, platform]
                              : current.filter((item) => item !== platform)
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block">{platform.replace(" Marketplace", "")}</span>
                        <span
                          className={`block font-mono text-[11px] ${
                            !connectionsLoaded
                              ? "text-grey"
                              : connectionStatus[platform] === "connected"
                                ? "text-ledger"
                                : "text-grey"
                          }`}
                        >
                          {!connectionsLoaded ? (
                            "checking…"
                          ) : connectionStatus[platform] === "connected" ? (
                            "connected"
                          ) : (
                            <Link href="/platforms" className="underline">
                              Connect {platform.replace(" Marketplace", "")}
                            </Link>
                          )}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {listing.attributes && (
                <dl className="mt-5 grid grid-cols-2 gap-3 text-[14px]">
                  <Row k="Category" v={listing.attributes.category} />
                  <Row k="Brand" v={listing.attributes.brand || "not visible"} />
                  <Row k="Condition" v={listing.attributes.condition} />
                  <Row k="Model" v={listing.attributes.model || "—"} />
                </dl>
              )}
              {listing.description && (
                <p className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                  {listing.description}
                </p>
              )}
            </>
          )}

          {listing.comps && (
            <div className="mt-6 border border-line">
              <div className="flex items-baseline justify-between gap-3 border-b border-line bg-wash/80 px-4 py-3">
                <p className="text-[14px] font-medium text-ink">Comps</p>
                {verifiedComps && listing.comps.median != null ? (
                  <span className="price-tag rounded-sm px-2 py-0.5 text-[14px]">
                    med {money(listing.comps.median)}
                  </span>
                ) : (
                  <span className="font-mono text-[12px] text-grey">
                    {listing.comps.comps.length} / 3 cited URLs
                  </span>
                )}
              </div>
              {(listing.attributes?.search_query || listing.comps.query) && (
                <p className="border-b border-line px-4 py-2 font-mono text-[12px] text-grey">
                  query: {listing.attributes?.search_query || listing.comps.query}
                </p>
              )}
              {!verifiedComps && (
                <div className="border-b border-line px-4 py-4">
                  <p className="text-[14px] font-medium text-ink">No suggested ask yet</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-grey">
                    {listing.comps.failure_reason ||
                      "Fewer than three comps with real listing URLs. Set the ask yourself, or re-run comps after adding clearer photos."}
                  </p>
                </div>
              )}
              {listing.comps.comps.length > 0 ? (
                <ul>
                  {listing.comps.comps.slice(0, 8).map((comp, index) => (
                    <li
                      key={`${comp.source}-${comp.url}-${comp.price}-${index}`}
                      className="grid gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] text-ink">{comp.title}</p>
                        <a
                          href={comp.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all font-mono text-[11px] text-grey hover:text-ink"
                        >
                          {comp.url}
                        </a>
                      </div>
                      <p className="font-mono text-[14px] text-ink sm:text-right">
                        {money(comp.unit_price ?? comp.price)}
                        {comp.sold ? " sold" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-6">
                  <p className="font-mono text-[12px] text-grey">0 cited listing URLs</p>
                </div>
              )}
            </div>
          )}
          <AgentLog
            events={events}
            busy={busy}
            stage={listing.pipeline_stage}
            onStop={onStop}
            stopping={stopping}
          />
          {listing.status === "error" && (
            <div className="mt-4">
              <p className="text-stamp">{listing.pipeline_error}</p>
              <button
                type="button"
                onClick={runLister}
                className="btn-secondary mt-3 w-full"
              >
                Run Sold Agent again
              </button>
            </div>
          )}
        </div>
      </div>

      {(listing.status === "ready" || listing.status === "rejected") && (
        <div className="safe-bottom border-t border-line bg-card px-4 py-3">
          {listing.status === "ready" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-[12px] font-medium text-grey">
                {Number.isFinite(price) && price > 0 ? "Ask price" : "Ask price (required)"}
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder=""
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  className="h-11 rounded-lg border border-line bg-paper px-3 text-[15px]"
                />
              </label>
              <label className="grid gap-1 rounded-lg border border-line bg-wash px-2.5 py-1.5 text-[12px] font-medium text-ink">
                Floor price (private)
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder=""
                  value={floorText}
                  onChange={(e) => setFloorText(e.target.value)}
                  className="h-10 border-0 bg-transparent text-[15px] outline-none focus:outline-none"
                />
                <span className="text-[11px] font-normal text-grey">
                  Never shown to buyers
                </span>
              </label>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-sold">{error}</p>}
          {listing.status === "ready" ? (
            <>
              <button
                type="button"
                onClick={() =>
                  void saveDraft({
                    title,
                    description,
                    price,
                    floor_price: Number.isFinite(floor) && floor >= 0 ? floor : 0,
                    platforms,
                    attributes: {
                      brand,
                      category,
                      condition,
                      model,
                    },
                  })
                }
                disabled={Boolean(busy) || !title.trim()}
                className="btn-secondary mt-3 w-full disabled:opacity-50"
              >
                {busy === "save" ? "Saving…" : "Save draft"}
              </button>
              <button
                onClick={() =>
                  approve({
                    title,
                    description,
                    price,
                    floor_price: Number.isFinite(floor) && floor >= 0 ? floor : 0,
                    platforms,
                    attributes: {
                      brand,
                      category,
                      condition,
                      model,
                    },
                  })
                }
                disabled={busy === "post" || !canApprove}
                className="btn-primary mt-2 w-full disabled:opacity-50"
              >
                {busy === "post" ? "Posting listing…" : "Post listing"}
              </button>
              <p className="mt-2 text-center text-[12px] text-grey">
                {!connectionsLoaded
                  ? "Checking connected accounts…"
                  : platforms.length === 0
                    ? "Select a connected platform before posting."
                    : missingAccounts.length > 0
                      ? `Connect ${formatPlatformList(missingAccounts)} before you can post.`
                      : `Posts to ${formatPlatformList(platforms)}. Status stays Submitted until Sold has a public URL.`}{" "}
                <Link href="/platforms" className="text-ink underline">
                  Accounts
                </Link>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={reject}
                  disabled={Boolean(busy)}
                  className="btn-secondary h-11 text-[13px]"
                >
                  Don&apos;t post
                </button>
                <button
                  type="button"
                  onClick={() => discard()}
                  disabled={Boolean(busy)}
                  className="h-11 text-[13px] font-medium text-stamp"
                >
                  {busy === "takedown" ? "Taking down…" : "Delete listing"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink/60">
                {hasLiveMarketplace(listing)
                  ? "Craigslist is down, but Facebook still looks live in Sold. Delete forever removes the ticket here even if Facebook is stuck."
                  : /taken down/i.test(listing.pipeline_stage || "")
                    ? "Taken down from the marketplaces. It is no longer live."
                    : "Rejected — it never went live."}
              </p>
              {error && <p className="mt-2 text-sm text-sold">{error}</p>}
              <button
                type="button"
                onClick={restore}
                disabled={Boolean(busy)}
                className="btn-primary mt-3 w-full"
              >
                Restore draft
              </button>
              <button
                type="button"
                onClick={() => discard(true)}
                disabled={Boolean(busy)}
                className="mt-2 h-12 w-full rounded-xl text-sm text-sold"
              >
                {busy === "takedown" ? "Taking down…" : "Delete forever"}
              </button>
            </>
          )}
        </div>
      )}

      {listing.status === "analyzing" && (
        <div className="safe-bottom border-t border-line bg-card px-4 py-3">
          <button
            type="button"
            onClick={() => discard()}
            disabled={Boolean(busy)}
            className="h-12 w-full rounded-xl text-sm text-sold"
          >
            Cancel listing
          </button>
        </div>
      )}
    </div>
  );
}

const STUCK_AFTER_MS = 45_000;

function latestWorkEvent(events: AgentEvent[]) {
  return [...events]
    .reverse()
    .find((event) => /REVISE|FORM|WATCH|LISTER|COPY|THINK|TAKEDOWN/i.test(event.action));
}

function reviseProgress(events: AgentEvent[]) {
  return latestWorkEvent(events)?.detail || "Opening the live listing…";
}

function workAgeMs(events: AgentEvent[], startedAt?: number) {
  const stamped = Date.parse(latestWorkEvent(events)?.timestamp || "");
  const from = Number.isFinite(stamped) ? stamped : startedAt || Date.now();
  return Date.now() - from;
}

function formatAgo(ms: number) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [active]);
  return now;
}

function WorkPulse({
  events,
  working,
  startedAt,
}: {
  events: AgentEvent[];
  working: boolean;
  startedAt?: number;
}) {
  useNow(working);
  if (!working) return null;
  const age = workAgeMs(events, startedAt);
  const stuck = age >= STUCK_AFTER_MS;
  return (
    <p className={`mt-2 flex items-start gap-2 text-sm ${stuck ? "text-gold" : "text-sage"}`}>
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full ${
          stuck ? "bg-gold" : "bg-sage"
        }`}
      />
      <span>
        {stuck
          ? `No update in ${formatAgo(age).replace(" ago", "")}. It may be stuck.`
          : `${reviseProgress(events)} · last update ${formatAgo(age)}`}
      </span>
    </p>
  );
}

function liveEditsFromForm(
  listing: Listing,
  form: {
    title: string;
    description: string;
    priceText: string;
    pickup: string;
    brand: string;
    category: string;
    condition: string;
    model: string;
  }
) {
  const edits: {
    price?: number;
    title?: string;
    description?: string;
    pickup?: string;
    brand?: string;
    category?: string;
    condition?: string;
    model?: string;
  } = {};
  const title = form.title.trim().slice(0, 80);
  if (title && title !== listing.title) edits.title = title;
  if (form.description !== listing.description) edits.description = form.description;
  const price = Number(form.priceText);
  if (Number.isFinite(price) && price > 0 && Math.abs(price - listing.price) >= 0.01) {
    edits.price = Math.round(price * 100) / 100;
  }
  const pickup = form.pickup.trim();
  if (pickup !== (listing.hints?.pickup_notes || "").trim()) edits.pickup = pickup;
  if (form.brand !== (listing.attributes?.brand || "")) edits.brand = form.brand;
  if (form.category !== (listing.attributes?.category || "")) edits.category = form.category;
  if (form.condition !== (listing.attributes?.condition || "")) edits.condition = form.condition;
  if (form.model !== (listing.attributes?.model || "")) edits.model = form.model;
  return edits;
}

function LiveListingView({
  listing,
  events,
  threads,
  connectionStatus,
  busy,
  facebookGone,
  onResume,
  onRefresh,
  onRevised,
  onWorking,
  onOpenChats,
  onStop,
  stopping,
}: {
  listing: Listing;
  events: AgentEvent[];
  threads: ReturnType<typeof conversationsForListing>;
  connectionStatus: Partial<Record<Platform, PlatformConnectionStatus>>;
  busy: string;
  facebookGone?: boolean;
  onResume: () => void;
  onRefresh: () => Promise<unknown>;
  onRevised: (listing: Listing) => void;
  onWorking?: (working: boolean) => void;
  onOpenChats: () => void;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const buyerCount = threads.filter((thread) => !thread.demo || thread.last).length;
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [priceText, setPriceText] = useState(
    listing.price > 0 ? listing.price.toFixed(2) : ""
  );
  const [pickup, setPickup] = useState(listing.hints?.pickup_notes || "");
  const [brand, setBrand] = useState(listing.attributes?.brand || "");
  const [category, setCategory] = useState(listing.attributes?.category || "");
  const [condition, setCondition] = useState(listing.attributes?.condition || "");
  const [model, setModel] = useState(listing.attributes?.model || "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [takingDown, setTakingDown] = useState(false);
  const [confirmDown, setConfirmDown] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState("");
  const working = saving || takingDown;
  const edits = liveEditsFromForm(listing, {
    title,
    description,
    priceText,
    pickup,
    brand,
    category,
    condition,
    model,
  });
  const dirty = Object.keys(edits).length > 0;

  useEffect(() => {
    setTitle(listing.title);
    setDescription(listing.description);
    setPriceText(listing.price > 0 ? listing.price.toFixed(2) : "");
    setPickup(listing.hints?.pickup_notes || "");
    setBrand(listing.attributes?.brand || "");
    setCategory(listing.attributes?.category || "");
    setCondition(listing.attributes?.condition || "");
    setModel(listing.attributes?.model || "");
  }, [
    listing.id,
    listing.title,
    listing.description,
    listing.price,
    listing.hints?.pickup_notes,
    listing.attributes?.brand,
    listing.attributes?.category,
    listing.attributes?.condition,
    listing.attributes?.model,
  ]);

  useEffect(() => {
    if (!working) return;
    const tick = window.setInterval(() => {
      void onRefresh();
    }, 1000);
    return () => window.clearInterval(tick);
  }, [working, onRefresh]);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setStartedAt(Date.now());
    onWorking?.(true);
    setError("");
    try {
      const res = await fetch(`/api/listings/${listing.id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not update the live listing.");
      } else if (data.listing) {
        onRevised(data.listing);
        setEditing(false);
      }
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the live listing.");
    } finally {
      setSaving(false);
      onWorking?.(false);
    }
  }

  async function takeDown() {
    if (takingDown || saving) return;
    if (!confirmDown) {
      setConfirmDown(true);
      setError("");
      return;
    }
    setTakingDown(true);
    setStartedAt(Date.now());
    onWorking?.(true);
    setError("");
    try {
      const res = await fetch(`/api/listings/${listing.id}/takedown`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not take the listing down.");
        setConfirmDown(false);
      } else if (data.listing) {
        onRevised(data.listing);
        setConfirmDown(false);
      }
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not take the listing down.");
      setConfirmDown(false);
    } finally {
      setTakingDown(false);
      onWorking?.(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch]">
        {facebookGone && (
          <div className="mb-3 rounded-2xl bg-card px-4 py-3">
            <p className="text-[1.15rem] font-semibold tracking-[-0.02em]">Gone from Facebook</p>
            <p className="mt-1 text-sm text-ink/60">
              Chrome checked Selling. This listing is no longer on Marketplace.
            </p>
          </div>
        )}
        <PhotoTray photos={listing.photos} onRemove={() => undefined} onAdd={() => undefined} locked />
        {!editing ? (
          <>
            <h2 className="mt-5 text-[1.75rem] font-bold tracking-[-0.03em]">{listing.title}</h2>
            <p className="mt-1 font-mono text-lg">{money(listing.price)}</p>
            {listing.description && (
              <p className="mt-5 whitespace-pre-wrap text-base leading-relaxed">
                {listing.description}
              </p>
            )}
          </>
        ) : (
        <div className="mt-5 grid gap-3">
          <label className="grid gap-1 text-sm">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-12 rounded-xl border border-line bg-paper px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Price
            <input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(event) => setPriceText(event.target.value)}
              className="h-12 rounded-xl border border-line bg-paper px-3 font-mono"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              className="rounded-xl border border-line bg-paper px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              Brand
              <input
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                className="h-12 rounded-xl border border-line bg-paper px-3"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Category
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-12 rounded-xl border border-line bg-paper px-3"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Condition
              <select
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                className="h-12 rounded-xl border border-line bg-paper px-3"
              >
                <option value="">From photo</option>
                <option>new</option>
                <option>like new</option>
                <option>good</option>
                <option>fair</option>
                <option>poor</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Model
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="h-12 rounded-xl border border-line bg-paper px-3"
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Pickup
            <input
              value={pickup}
              onChange={(event) => setPickup(event.target.value)}
              className="h-12 rounded-xl border border-line bg-paper px-3"
            />
          </label>
        </div>
        )}
        {listing.platforms.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[12px] font-medium text-ink/40">
              Live on
            </p>
            <LiveLinks
              listing={listing}
              connectionStatus={connectionStatus}
              onResume={onResume}
              busy={busy}
            />
          </div>
        )}
        <button
          type="button"
          onClick={onOpenChats}
          className="mt-5 flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3 text-left"
        >
          <span>
            <span className="block text-[1.15rem] font-semibold tracking-[-0.02em]">Buyer chats</span>
            <span className="mt-0.5 block text-sm text-ink/55">
              {buyerCount === 0
                ? "No marketplace buyers yet. A chat appears only when someone writes you. Demo is practice inside Sold."
                : `${buyerCount} ${buyerCount === 1 ? "person" : "people"}`}
            </span>
          </span>
          <span className="text-ink/40">→</span>
        </button>
        <AgentLog
          events={events}
          busy={busy || (saving ? "revise" : takingDown ? "takedown" : "")}
          stage={listing.pipeline_stage}
          onStop={onStop}
          stopping={stopping}
        />
      </div>
      <div className="safe-bottom border-t border-line bg-card px-4 py-3">
        {editing ? (
          <>
            <WorkPulse events={events} working={saving} startedAt={startedAt} />
            {error && <p className="mb-2 text-sm text-sold">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
                className="h-12 rounded-xl border border-line text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void save()}
                className="h-12 rounded-xl bg-ink text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <>
            <WorkPulse events={events} working={takingDown} startedAt={startedAt} />
            {error && <p className="mb-2 text-sm text-sold">{error}</p>}
            {confirmDown && !takingDown && (
              <p className="mb-2 text-sm text-ink/60">
                This deletes the live marketplace posts, then removes them from Sold.
              </p>
            )}
            <button
              type="button"
              disabled={takingDown}
              onClick={() => setEditing(true)}
              className="h-12 w-full rounded-xl bg-ink text-sm font-medium text-white disabled:opacity-50"
            >
              Edit post
            </button>
            <button
              type="button"
              disabled={takingDown}
              onClick={() => void takeDown()}
              className="mt-2 h-12 w-full rounded-xl text-sm text-sold disabled:opacity-50"
            >
              {takingDown
                ? "Taking down…"
                : confirmDown
                  ? "Take down now"
                  : "Take down"}
            </button>
            {confirmDown && !takingDown && (
              <button
                type="button"
                onClick={() => setConfirmDown(false)}
                className="mt-1 h-10 w-full text-sm text-ink/50"
              >
                Keep it live
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ThreadList({
  listing,
  threads,
  onOpen,
  facebookGone,
}: {
  listing: Listing;
  threads: ReturnType<typeof conversationsForListing>;
  onOpen: (id: string) => void;
  facebookGone?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {facebookGone && (
          <div className="mb-3 rounded-2xl bg-card px-4 py-3">
            <p className="text-[1.15rem] font-semibold tracking-[-0.02em]">Gone from Facebook</p>
            <p className="mt-1 text-sm text-ink/60">
              Chrome checked Selling. This listing is no longer on Marketplace.
            </p>
          </div>
        )}
        <p className="text-[12px] font-medium text-ink/40">
          buyers
        </p>
        <h2 className="mt-1 text-[1.75rem] font-bold tracking-[-0.03em]">
          Each person is a thread.
        </h2>
        <p className="mt-2 text-sm text-ink/60">
          Real Marketplace buyers land here as themselves. The Demo thread is
          only for practicing in Sold.
        </p>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-card">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onOpen(thread.id)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-wash/60"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wash text-lg font-semibold">
                  {thread.buyer_name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-serif text-base leading-tight">
                      {thread.buyer_name}
                    </span>
                    {thread.demo && (
                      <span className="stamp shrink-0 text-[8px] text-ink/45">
                        demo
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink/55">
                    {thread.last
                      ? thread.last.text
                      : `No messages on ${listing.title || "this listing"} yet.`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ChatView({
  buyerName,
  messages,
  events,
  chips,
  sender,
  setSender,
  draft,
  setDraft,
  busy,
  error,
  send,
  stampAccept,
  listingSold,
  chatEnd,
  onActivity,
  watchingFacebook,
  facebookGone,
}: {
  buyerName: string;
  messages: Message[];
  events: AgentEvent[];
  chips: string[];
  sender: "buyer" | "human";
  setSender: (s: "buyer" | "human") => void;
  draft: string;
  setDraft: (s: string) => void;
  busy: string;
  error: string;
  send: (text?: string) => void;
  stampAccept: (messageId: string) => void;
  listingSold: boolean;
  chatEnd: React.RefObject<HTMLDivElement | null>;
  onActivity: () => void;
  watchingFacebook?: boolean;
  facebookGone?: boolean;
}) {
  const lastAgent = [...events].reverse().find((e) => e.agent === "negotiator");
  const pendingStamp = [...messages]
    .reverse()
    .find(
      (message) =>
        message.sender === "agent" &&
        message.action === "accept" &&
        !listingSold
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 [-webkit-overflow-scrolling:touch]">
        {facebookGone && (
          <div className="rounded-2xl bg-card px-4 py-3">
            <p className="text-[1.15rem] font-semibold tracking-[-0.02em]">Gone from Facebook</p>
            <p className="mt-1 text-sm text-ink/60">
              Chrome checked Selling. This listing is no longer on Marketplace,
              so Sold stopped watching it.
            </p>
          </div>
        )}
        {messages.length === 0 && !facebookGone && (
          <div className="rounded-2xl bg-card px-4 py-3">
            <p className="text-[1.15rem] font-semibold tracking-[-0.02em]">
              {watchingFacebook ? "Watching Facebook" : "Start the conversation"}
            </p>
            <p className="mt-1 text-sm text-ink/60">
              {watchingFacebook
                ? `Sold is watching Marketplace for ${buyerName}. When they write, the draft lands in this thread — you reply on Facebook.`
                : `Message as ${buyerName}, or switch to You to reply directly. Agent replies are drafts until you stamp an accept.`}
            </p>
          </div>
        )}
        {messages.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            showStamp={pendingStamp?.id === message.id}
            onStamp={() => void stampAccept(message.id)}
            stampBusy={busy === "stamp"}
          />
        ))}
        {busy === "chat" && (
          <p className="text-[12px] font-medium text-sold">
            Negotiator deciding…
          </p>
        )}
        <div ref={chatEnd} />
      </div>

      <div className="safe-bottom shrink-0 border-t border-line bg-paper px-3 pt-2">
        {facebookGone ? null : watchingFacebook ? (
          <p className="mb-2 text-[12px] text-grey">
            Facebook thread · monitor-only. Reply on Facebook; Sold shows the messages here.
          </p>
        ) : pendingStamp ? (
          <p className="mb-2 text-[12px] text-stamp">
            Accept draft ready. Stamp to mark sold — Sold will not send this for you yet.
          </p>
        ) : (
          <p className="mb-2 text-[12px] text-grey">
            Agent replies stay in Sold as drafts. Floor is enforced in code, not just the prompt.
          </p>
        )}
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onActivity}
            className="min-w-0 truncate text-[12px] font-medium text-grey"
          >
            {lastAgent ? `${lastAgent.action} · activity` : "Activity"}
          </button>
          <div className="flex shrink-0 rounded-lg border border-line bg-wash p-0.5 text-[12px] font-semibold">
            <label className={`cursor-pointer px-2 py-1 ${sender === "buyer" ? "bg-ink text-paper" : "text-grey"}`}>
              <input
                type="radio"
                checked={sender === "buyer"}
                onChange={() => setSender("buyer")}
                className="sr-only"
              />
              Buyer
            </label>
            <label className={`cursor-pointer px-2 py-1 ${sender === "human" ? "bg-ink text-paper" : "text-grey"}`}>
              <input
                type="radio"
                checked={sender === "human"}
                onChange={() => setSender("human")}
                className="sr-only"
              />
              You
            </label>
          </div>
        </div>
        <div className="-mx-3 mb-1.5 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => {
                setSender("buyer");
                void send(chip);
              }}
              className="shrink-0 border border-line bg-card px-2.5 py-1 text-[12px] text-grey"
            >
              {chip}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              watchingFacebook
                ? "Monitor-only — reply on Facebook"
                : sender === "human"
                  ? "Your reply (stays in Sold until you send on the marketplace)…"
                  : `Message as ${buyerName}…`
            }
            disabled={watchingFacebook}
            className="h-11 min-w-0 flex-1 border border-line bg-card px-3 text-[16px] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy === "chat" || watchingFacebook}
            className="btn-primary h-11 shrink-0 px-4 text-[13px] disabled:opacity-50"
          >
            {sender === "human" ? "Save reply" : "Send message"}
          </button>
        </form>
        {error && <p className="pb-2 text-[13px] text-stamp">{error}</p>}
      </div>
    </div>
  );
}

function Sheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-ink/40">
      <button type="button" className="flex-1" onClick={onClose} aria-label="Close" />
      <div className="safe-bottom max-h-[75%] overflow-y-auto rounded-t-3xl bg-paper px-5 py-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        {children}
      </div>
    </div>
  );
}

function Ticket({
  listing,
  connectionStatus,
  onResume,
  busy,
}: {
  listing: Listing;
  connectionStatus: Partial<Record<Platform, PlatformConnectionStatus>>;
  onResume: () => void;
  busy: string;
}) {
  return (
    <div>
      <h2 className="text-[1.75rem] font-bold tracking-[-0.03em]">{listing.title}</h2>
      <p className="mt-1 font-mono text-lg">{money(listing.price)}</p>
      {listing.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">
          {listing.description}
        </p>
      )}
      {listing.price_reasoning && (
        <p className="mt-3 text-sm italic text-ink/55">{listing.price_reasoning}</p>
      )}
      {listing.platforms.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[12px] font-medium text-ink/40">
            Platforms
          </p>
          <LiveLinks
            listing={listing}
            connectionStatus={connectionStatus}
            onResume={onResume}
            busy={busy}
          />
        </div>
      )}
    </div>
  );
}

function FacebookReviewNotice({
  listing,
  connectionStatus,
  busy,
  onResume,
}: {
  listing: Listing;
  connectionStatus: Partial<Record<Platform, PlatformConnectionStatus>>;
  busy: string;
  onResume: () => void;
}) {
  const facebook = listing.platform_posts.find(
    (post) => post.platform === "Facebook Marketplace"
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="stamp w-fit text-ink/70">in review</p>
        <h2 className="mt-3 text-[1.75rem] font-bold tracking-[-0.03em]">
          Waiting on Facebook review.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink/70">
          {facebook?.detail ||
            "Marketplace accepted the draft. It is not publicly live yet."}{" "}
          The Chrome watch checks Selling in the background. This screen updates when Facebook publishes a real item URL, or when the listing disappears.
          {facebook?.checked_at
            ? ` Last Selling check: ${new Date(facebook.checked_at).toLocaleTimeString()}.`
            : " Not rechecked since submit."}
        </p>
        <div className="mt-5">
          <LiveLinks
            listing={listing}
            connectionStatus={connectionStatus}
            onResume={onResume}
            busy={busy}
          />
        </div>
      </div>
    </div>
  );
}

function PostingProgress({
  listing,
  events,
  connectionStatus,
  busy,
  stopping,
  onStop,
}: {
  listing: Listing;
  events: AgentEvent[];
  connectionStatus: Partial<Record<Platform, PlatformConnectionStatus>>;
  busy: string;
  stopping?: boolean;
  onStop?: () => void;
}) {
  const pending = unpublishedMarketplacePlatforms(listing);
  const headline =
    pending.length > 0
      ? `Publishing to ${formatPlatformList(pending)}.`
      : "Publishing to marketplaces.";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="stamp w-fit text-sage">posting</p>
        <h2 className="mt-3 text-[1.75rem] font-bold tracking-[-0.03em]">{headline}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink/70">
          {listing.pipeline_stage || "The operator is filling the live form. This screen updates as each marketplace posts."}
        </p>
        <div className="mt-5">
          <LiveLinks
            listing={listing}
            connectionStatus={connectionStatus}
            onResume={() => undefined}
            busy={busy}
          />
        </div>
        <AgentLog
          events={events}
          busy={busy || "post"}
          stage={listing.pipeline_stage}
          onStop={onStop}
          stopping={stopping}
        />
      </div>
    </div>
  );
}

function UnfinishedPost({
  listing,
  events,
  connectionStatus,
  busy,
  error,
  stopping,
  onResume,
  onDiscard,
  onStop,
}: {
  listing: Listing;
  events: AgentEvent[];
  connectionStatus: Partial<Record<Platform, PlatformConnectionStatus>>;
  busy: string;
  error: string;
  stopping?: boolean;
  onResume: () => void;
  onDiscard: () => void;
  onStop?: () => void;
}) {
  const pending = unpublishedMarketplacePlatforms(listing);
  const attention = listing.platform_posts.filter(
    (post) =>
      post.platform !== "Gmail receipt" &&
      (post.status === "needs_attention" || post.status === "failed")
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="stamp w-fit text-sold">failed</p>
        <h2 className="mt-3 text-[1.75rem] font-bold tracking-[-0.03em]">
          Publishing failed on {formatPlatformList(pending) || "the marketplace"}.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink/70">
          {attention[0]?.detail ||
            listing.pipeline_error ||
            listing.pipeline_stage ||
            "The listing did not go live."}{" "}
          Chat opens only after a marketplace URL is verified. Email is sent after that.
        </p>
        <div className="mt-5">
          <LiveLinks
            listing={listing}
            connectionStatus={connectionStatus}
            onResume={onResume}
            busy={busy}
          />
        </div>
        {error && <p className="mt-3 text-sm text-sold">{error}</p>}
        <AgentLog
          events={events}
          busy={busy}
          stage={listing.pipeline_stage}
          onStop={onStop}
          stopping={stopping}
        />
      </div>
      <div className="safe-bottom border-t border-line bg-card px-4 py-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={Boolean(busy)}
          className="h-12 w-full rounded-xl text-sm text-sold"
        >
          {busy === "takedown" || busy === "reject"
            ? "Taking down live listings…"
            : "Delete this listing"}
        </button>
      </div>
    </div>
  );
}

function LiveLinks({
  listing,
  connectionStatus,
  onResume,
  busy,
}: {
  listing: Listing;
  connectionStatus: Partial<Record<Platform, PlatformConnectionStatus>>;
  onResume: () => void;
  busy: string;
}) {
  const rows = listing.platforms.map((platform) => {
    const existing = listing.platform_posts.find((post) => post.platform === platform);
    return (
      existing || {
        platform,
        status: "needs_attention" as const,
        via: "browserbase" as const,
        detail:
          listing.status === "live"
            ? "Sold is recapturing the live link. You already got the email if it posted."
            : "Not published yet.",
      }
    );
  });
  if (rows.length === 0) return null;
  return (
    <ul className="mb-2 space-y-2">
      {rows.map((post) => {
        const marketplace =
          post.platform === "Gmail receipt" ? undefined : post.platform;
        const connected = marketplace
          ? connectionStatus[marketplace] === "connected"
          : false;
        const recapturing =
          listing.status === "live" && post.status !== "posted";
        const showConnect = !recapturing && post.status !== "posted" && !connected;
        return (
          <li key={post.platform} className="rounded-xl bg-card px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{post.platform}</span>
              <span className="stamp text-[9px] text-ink/50">
                {post.remote_state === "review"
                  ? "in review"
                  : recapturing
                    ? "finding link"
                    : post.status.replaceAll("_", " ")}
              </span>
            </div>
            {post.detail && (
              <p className="mt-1 text-xs text-ink/55">{post.detail}</p>
            )}
            <div className="mt-2 flex gap-2">
              {showConnect && (
                <Link
                  href="/platforms"
                  className="flex-1 rounded-full border border-line px-3 py-2 text-center text-xs"
                >
                  Connect
                </Link>
              )}
              {post.session_url && (
                <a
                  href={post.session_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 rounded-full border border-gold px-3 py-2 text-center text-xs"
                >
                  Open session
                </a>
              )}
              {post.status === "posted" &&
                (() => {
                  const open = openListingLink(
                    post.platform,
                    listing.title,
                    post.remote_url
                  );
                  return open ? (
                    <a
                      href={open.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 rounded-full border border-line px-3 py-2 text-center text-xs"
                    >
                      {open.label}
                    </a>
                  ) : null;
                })()}
            </div>
            {!recapturing &&
              listing.status !== "posting" &&
              post.status !== "posted" &&
              post.status !== "posting" && (
              <button
                type="button"
                onClick={onResume}
                disabled={busy === "post" || !connected}
                className="mt-2 h-9 w-full rounded-xl bg-sold px-3 text-xs font-medium text-white disabled:opacity-50"
              >
                {busy === "post" ? "Publishing…" : "Try publishing again"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function agentLabel(agent: string) {
  if (agent === "evaluator") return "pricing";
  if (agent === "lister") return "sold agent";
  if (agent === "browser") return "browser";
  if (agent === "negotiator") return "negotiator";
  return agent;
}

function ActivityList({
  events,
  busy,
  compact,
}: {
  events: AgentEvent[];
  busy: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-2 space-y-2" : "space-y-3"}>
      {events.length === 0 && (
        <p className="text-sm text-ink/45">No activity yet.</p>
      )}
      {events.map((event) => (
        <div key={event.id} className="text-sm">
          <div className="flex items-center gap-2">
            <span className="stamp text-[9px] text-ink">{event.action}</span>
            <span className="text-[12px] text-ink/40">
              {agentLabel(event.agent)}
            </span>
            <span className="ml-auto text-[11px] text-ink/30">
              {formatAgo(Math.max(0, Date.now() - Date.parse(event.timestamp)))}
            </span>
          </div>
          <p className="mt-1 text-ink/70">{event.detail}</p>
        </div>
      ))}
      {busy && (
        <p className="text-[12px] font-medium text-sage">
          {busyLabel(busy)}
        </p>
      )}
    </div>
  );
}

function AgentLog({
  events,
  busy,
  stage,
  onStop,
  stopping,
}: {
  events: AgentEvent[];
  busy: string;
  stage?: string;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  const working = Boolean(busy);
  useNow(working);
  useEffect(() => {
    if (working) setExpanded(true);
  }, [working]);
  useEffect(() => {
    if (!expanded) return;
    end.current?.scrollIntoView({ block: "nearest" });
  }, [events.length, expanded]);
  const age = workAgeMs(events);
  const stuck = working && age >= STUCK_AFTER_MS;
  const latest = events.at(-1);
  const eventCount = `${events.length} ${events.length === 1 ? "event" : "events"}`;
  const live = latest?.detail || stage || busyLabel(busy);
  const summary = stuck
    ? `No update in ${formatAgo(age).replace(" ago", "")}. It may be stuck.`
    : working
      ? `${live} · ${formatAgo(age)}`
      : latest?.detail || latest?.action || "No activity yet";

  return (
    <section className="panel mt-5 overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="agent-log-events"
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ledger focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 ${
            stuck
              ? "animate-pulse bg-gold"
              : working
                ? "animate-pulse rounded-md bg-ink"
                : "bg-line"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-grey">
            Activity · {eventCount}
          </span>
          <span
            className={`block truncate text-[14px] ${
              stuck ? "text-gold" : working ? "text-ink" : "text-grey"
            }`}
          >
            {summary}
          </span>
        </span>
        {onStop && working && (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!stopping) onStop();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              if (!stopping) onStop();
            }}
            className="shrink-0 px-2 py-1 text-[12px] font-medium text-stamp"
          >
            {stopping || /stopping/i.test(stage || "") ? "Stopping…" : "Stop"}
          </span>
        )}
        <span
          aria-hidden="true"
          className={`shrink-0 text-sm text-grey transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          ↓
        </span>
      </button>
      {expanded && (
        <div id="agent-log-events" className="border-t border-line px-3.5 pb-3 pt-1">
          <ActivityList events={events} busy={busy} compact />
          <div ref={end} />
        </div>
      )}
    </section>
  );
}

function busyLabel(busy: string) {
  return busy === "chat"
    ? "Negotiator deciding…"
    : busy === "lister"
      ? "Sold Agent working…"
      : busy === "revise"
        ? "Updating live listing…"
        : busy === "takedown"
          ? "Taking down…"
          : busy === "reject"
            ? "Rejecting…"
            : "Posting…";
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[12px] text-grey">{k}</dt>
      <dd className="text-[14px] text-ink">{v}</dd>
    </div>
  );
}

function StatusManifest({ listing }: { listing: Listing }) {
  const livePost = listing.platform_posts.find(
    (post) =>
      post.platform !== "Gmail receipt" &&
      post.status === "posted" &&
      post.remote_state !== "review" &&
      (post.url || post.remote_url)
  );

  let label = "Draft";
  let className = "badge-draft";
  let note =
    listing.status === "ready"
      ? "Ready for your review. Nothing has posted."
      : listing.pipeline_stage || "Not posted.";
  let url: string | null = null;
  let stamped = false;

  if (listing.status === "sold") {
    label = "Sold";
    note = "Marked sold.";
    url = livePost?.url || livePost?.remote_url || null;
    stamped = true;
  } else if (livePost) {
    label = "Live";
    note = "Public URL on file.";
    url = livePost.url || livePost.remote_url || null;
    stamped = true;
  } else if (listing.status === "posting") {
    label = "Submitted";
    className = "badge-submitted";
    note = "Form filled. Not live until a public URL exists.";
  }

  return (
    <div className="mt-4 border border-line px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {stamped ? (
          <RubberStamp label={label} size="sm" rotate={-4} className="rubber-stamp--static" />
        ) : (
          <span className={`stamp ${className}`}>{label}</span>
        )}
        <span className="text-[13px] text-grey">{note}</span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block break-all font-mono text-[11px] text-ink"
        >
          {url}
        </a>
      )}
    </div>
  );
}

function Pipeline({ listing, busy }: { listing: Listing; busy: boolean }) {
  const steps = [
    { key: "photo", label: "Photo", done: listing.photos.length > 0 },
    { key: "identify", label: "Identify", done: Boolean(listing.attributes) },
    {
      key: "comps",
      label: "Comps",
      done: Boolean(listing.comps && listing.comps.comps.length >= 3),
    },
    { key: "draft", label: "Draft", done: Boolean(listing.title) },
    {
      key: "live",
      label: listing.status === "sold" ? "Sold" : "Live",
      done: listing.status === "live" || listing.status === "sold",
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol className="flex gap-2">
      {steps.map((step, i) => (
        <li key={step.key} className="flex-1">
          <span
            className={`block h-0.5 ${
              step.done
                ? "rounded-md bg-ink"
                : busy && i === next
                  ? "bg-ink"
                  : "bg-line"
            }`}
          />
          <span
            className={`mt-1.5 block text-[11px] font-medium ${
              step.done ? "text-ink" : "text-grey"
            }`}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Bubble({
  message,
  showStamp,
  onStamp,
  stampBusy,
}: {
  message: Message;
  showStamp?: boolean;
  onStamp?: () => void;
  stampBusy?: boolean;
}) {
  const mine = message.sender !== "buyer";
  const decision = message.decision || message.escalate_reason;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3 py-2 text-[14px] ${
          mine ? "bg-ink text-paper" : "border border-line bg-card text-ink"
        }`}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium opacity-70">
            {message.sender === "agent" ? "Sold Agent" : message.sender}
          </span>
          {message.action && (
            <ActionStamp action={message.action as NegotiatorAction} />
          )}
        </div>
        {message.text ? <p>{message.text}</p> : null}
        {decision && message.sender === "agent" && (
          <p
            className={`mt-2 text-[11px] font-medium ${mine ? "text-gold" : "text-grey"}`}
          >
            Why: {decision}
          </p>
        )}
        {showStamp && onStamp && (
          <button
            type="button"
            onClick={onStamp}
            disabled={stampBusy}
            className="mt-3 inline-flex items-center gap-2 border border-stamp/40 bg-paper px-3 py-1.5 text-[12px] font-medium text-stamp disabled:opacity-50"
          >
            {stampBusy ? "Stamping…" : "Stamp accept · mark sold"}
          </button>
        )}
      </div>
    </div>
  );
}
