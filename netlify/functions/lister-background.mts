import type { Config } from "@netlify/functions";
import { getListing, logAgent, updateListing } from "../../src/lib/db";
import { runLister } from "../../src/lib/agents/graph";

export default async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    force?: boolean;
  };
  const id = body.id;
  if (!id) return;

  const listing = await getListing(id);
  if (!listing) return;
  if (
    !body.force &&
    (listing.status === "ready" || listing.status === "live" || listing.status === "sold")
  ) {
    return;
  }

  try {
    await runLister(listing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lister failed";
    await updateListing(id, {
      status: "error",
      pipeline_stage: "Failed",
      pipeline_error: message,
    }).catch(() => undefined);
    await logAgent(id, "lister", "ERROR", message).catch(() => undefined);
  }
};

export const config: Config = {
  background: true,
};
