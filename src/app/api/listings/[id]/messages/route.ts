import { NextResponse } from "next/server";
import {
  getListing,
  insertMessage,
  listEvents,
  listMessages,
  logAgent,
  updateListing,
} from "@/lib/db";
import { runNegotiator } from "@/lib/agents/graph";
import {
  DEMO_BUYER_NAME,
  buyerNameFromId,
  demoConversationId,
} from "@/lib/conversations";
import type { Sender } from "@/lib/types";
import { withOwnedListing } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withOwnedListing(id, async () =>
    NextResponse.json(await listMessages(id))
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withOwnedListing(id, async (_user, listing) => {
    const body = (await req.json()) as {
      text?: string;
      sender?: Sender;
      conversation_id?: string;
      buyer_name?: string;
      stamp_message_id?: string;
    };

    if (body.stamp_message_id) {
      const messages = await listMessages(id);
      const draft = messages.find((message) => message.id === body.stamp_message_id);
      if (!draft || draft.sender !== "agent" || draft.action !== "accept") {
        return NextResponse.json(
          { error: "Stamp only works on an accept draft from Sold Agent." },
          { status: 400 }
        );
      }
      if (listing.status !== "live" && listing.status !== "sold") {
        return NextResponse.json(
          { error: "Listing must be live before you can stamp a sale." },
          { status: 400 }
        );
      }
      await updateListing(id, { status: "sold", pipeline_stage: "Sold" });
      await insertMessage({
        id: crypto.randomUUID(),
        listing_id: id,
        conversation_id: draft.conversation_id,
        buyer_name: draft.buyer_name,
        sender: "human",
        text: "Stamped accept — marked sold.",
        action: "accept",
        decision: "Seller stamped the accept draft.",
        escalate: false,
        escalate_reason: "",
        timestamp: new Date().toISOString(),
      });
      await logAgent(
        id,
        "negotiator",
        "STAMP",
        `Seller stamped accept for ${draft.buyer_name || "buyer"}. Marked sold.`
      );
      return NextResponse.json({
        listing: await getListing(id),
        messages: await listMessages(id),
        events: await listEvents(id),
      });
    }

    if (listing.status !== "live" && listing.status !== "sold") {
      return NextResponse.json(
        {
          error:
            "Listing must be live before the Negotiator can talk to buyers.",
        },
        { status: 400 }
      );
    }

    const text = (body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Message is empty." }, { status: 400 });
    }

    const conversationId =
      body.conversation_id === "buyer-1" || !body.conversation_id
        ? demoConversationId(id)
        : body.conversation_id;
    const buyerName =
      body.buyer_name?.trim() ||
      buyerNameFromId(conversationId, DEMO_BUYER_NAME);
    const sender: Sender = body.sender === "human" ? "human" : "buyer";
    await insertMessage({
      id: crypto.randomUUID(),
      listing_id: id,
      conversation_id: conversationId,
      buyer_name: buyerName,
      sender,
      text,
      action: null,
      decision: "",
      escalate: false,
      escalate_reason: "",
      timestamp: new Date().toISOString(),
    });

    if (sender === "human") {
      await logAgent(
        id,
        "negotiator",
        "HUMAN",
        `Alex took over: “${text.slice(0, 80)}”`
      );
      return NextResponse.json({
        listing: await getListing(id),
        messages: await listMessages(id),
        events: await listEvents(id),
      });
    }

    const result = await runNegotiator((await getListing(id))!, text);
    await insertMessage({
      id: crypto.randomUUID(),
      listing_id: id,
      conversation_id: conversationId,
      buyer_name: buyerName,
      sender: "agent",
      text: result.reply_text,
      action: result.action,
      escalate: result.escalate,
      escalate_reason: result.escalate_reason,
      decision: result.decision,
      timestamp: new Date().toISOString(),
    });

    if (result.action === "accept") {
      await logAgent(
        id,
        "negotiator",
        "DRAFT",
        "Accept draft ready. Waiting for your stamp before marking sold."
      );
    }

    return NextResponse.json({
      listing: await getListing(id),
      messages: await listMessages(id),
      events: await listEvents(id),
      result,
    });
  });
}
