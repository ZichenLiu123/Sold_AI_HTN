import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { extractAttributes } from "./vision";
import { mergeCompData, searchComps, hasSoldPriceLock, relevanceTokens } from "./browser";
import { lookupOpenAIMarketPrice } from "./openai-price";
import { evaluateComps } from "./evaluator";
import { generateListingCopy } from "./lister";
import { negotiate } from "./negotiator";
import { getListing, listMessages, logAgent, updateListing } from "../db";
import type {
  CompData,
  GeneratedListing,
  ItemAttributes,
  Listing,
  Message,
  NegotiatorResult,
  UserHints,
} from "../types";
import { roundClean } from "../util";
import { clearCancel, isAgentCancelled, markAgentIdle, markAgentRunning, throwIfCancelled } from "./cancel";

const ListerState = Annotation.Root({
  listingId: Annotation<string>(),
  photos: Annotation<string[]>(),
  hints: Annotation<UserHints>(),
  attributes: Annotation<ItemAttributes | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  comps: Annotation<CompData | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  generated: Annotation<GeneratedListing | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

async function visionNode(state: typeof ListerState.State) {
  throwIfCancelled(state.listingId);
  await updateListing(state.listingId, {
    pipeline_stage: "Reading the photos",
    status: "analyzing",
  });
  await logAgent(
    state.listingId,
    "lister",
    "VISION",
    "Looking at the photos to fill brand, model, and condition."
  );
  const attributes = await extractAttributes(state.photos, state.hints);
  throwIfCancelled(state.listingId);
  const previous = await getListing(state.listingId);
  if (!attributes.brand && previous?.attributes?.brand) {
    attributes.brand = previous.attributes.brand;
    if (attributes.confidence === "low") {
      attributes.confidence = previous.attributes.confidence || "medium";
    }
  }
  const brand = attributes.brand || "no brand visible";
  const model = attributes.model || "no model on the item";
  await logAgent(
    state.listingId,
    "lister",
    "VISION",
    `Saw ${attributes.category} · ${brand} · ${model} · ${attributes.condition}${
      attributes.flaws.length ? ` · flaws: ${attributes.flaws.join(", ")}` : " · no visible flaws"
    }.`
  );
  await updateListing(state.listingId, { attributes, pipeline_stage: "Photos read" });
  return { attributes };
}

async function compsNode(state: typeof ListerState.State) {
  throwIfCancelled(state.listingId);
  await updateListing(state.listingId, {
    pipeline_stage: "Checking comps across marketplaces",
  });
  const attributes = state.attributes || {
    category: state.hints.category || "item",
    brand: state.hints.brand || null,
    model: null,
    condition: state.hints.condition || "good",
    flaws: [],
    color: null,
    notable_features: [],
    visible_text: [],
    confidence: "low",
  };
  const identity = [attributes.brand, attributes.model].filter(Boolean).join(" ");
  await logAgent(
    state.listingId,
    "browser",
    "COMPS",
    identity
      ? `Searching eBay, Craigslist, Facebook, Mercari, OfferUp, Poshmark, and Google Shopping for “${identity}”.`
      : "No printed model. Searching Browserbase with the visual description."
  );
  if (identity) {
    await logAgent(
      state.listingId,
      "browser",
      "COMPS",
      "Also asking OpenAI for a market price in parallel."
    );
  }
  const livePromise = searchComps(attributes, {
    onSession: async () => {
      await updateListing(state.listingId, {
        pipeline_stage: "Browserbase is open. Searching marketplaces…",
      });
      await logAgent(
        state.listingId,
        "browser",
        "COMPS",
        "Browserbase session opened. Checking each marketplace now."
      );
    },
    onSource: async (name, found, reason) => {
      throwIfCancelled(state.listingId);
      await updateListing(state.listingId, {
        pipeline_stage: `Comps: ${name} ${found > 0 ? `found ${found}` : "had no usable hits"}`,
      });
      await logAgent(
        state.listingId,
        "browser",
        "COMPS",
        found > 0
          ? `${name}: ${found} candidate${found === 1 ? "" : "s"}.`
          : `${name}: no usable hits${reason ? ` (${reason})` : ""}.`
      );
    },
  });
  const webPromise = identity
    ? lookupOpenAIMarketPrice(attributes).catch(() => null)
    : Promise.resolve(null);
  const live = await livePromise;
  const web = hasSoldPriceLock(live) ? null : await webPromise;
  const tokens = relevanceTokens(attributes);
  const merged = web
    ? mergeCompData(live, web, tokens.any, tokens.all)
    : live;
  await updateListing(state.listingId, {
    pipeline_stage: "Checking if those prices are actually comparable",
  });
  await logAgent(
    state.listingId,
    "evaluator",
    "EVAL",
    "Checking whether each hit is the same product and converting packs to a per-item price."
  );
  const comps = await evaluateComps(attributes, merged);
  const kept = comps.comps.length;
  const packs = comps.comps.filter((comp) => (comp.quantity || 1) > 1).length;
  await updateListing(state.listingId, { comps, pipeline_stage: "Comps in" });
  const range =
    comps.median != null
      ? `${comps.min}–${comps.max} (median ${comps.median})`
      : "no usable unit price";
  await logAgent(
    state.listingId,
    "evaluator",
    "EVAL",
    comps.median != null
      ? `Kept ${kept} comps${packs ? `, including ${packs} packs divided to per-item` : ""}. Unit median $${comps.median}.`
      : comps.failure_reason || "Not enough comps after quantity checks."
  );
  await logAgent(
    state.listingId,
    "browser",
    "COMPS",
    `${comps.mocked ? "Estimated" : "Live"} comps for “${comps.query}”: ${range}. ${comps.source}`
  );
  return { comps };
}

async function copyNode(state: typeof ListerState.State) {
  throwIfCancelled(state.listingId);
  await updateListing(state.listingId, {
    pipeline_stage: "Writing the listing",
  });
  await logAgent(
    state.listingId,
    "lister",
    "COPY",
    "Writing the listing. A price is added only when verified comps or a seller price exists."
  );
  if (!state.attributes) {
    throw new Error("Vision step produced no attributes");
  }
  const generated = await generateListingCopy(
    state.attributes,
    state.hints,
    state.comps
  );
  throwIfCancelled(state.listingId);
  const price = generated.suggested_price;
  const floor = roundClean(price * 0.8);
  await updateListing(state.listingId, {
    title: generated.title,
    description: generated.description,
    price,
    floor_price: floor,
    platforms: generated.suggested_platforms,
    price_reasoning: generated.price_reasoning,
    status: "ready",
    pipeline_stage: "Needs your review",
    pipeline_error: null,
  });
  await logAgent(
    state.listingId,
    "lister",
    "COPY",
    price > 0
      ? `Suggested $${price} (floor $${floor}, hidden). ${generated.price_reasoning} Platforms: ${generated.suggested_platforms.join(", ")}.`
      : `Drafted without a price. ${generated.price_reasoning} Platforms: ${generated.suggested_platforms.join(", ")}.`
  );
  return { generated };
}

const listerGraph = new StateGraph(ListerState)
  .addNode("vision_extract", visionNode)
  .addNode("comp_search", compsNode)
  .addNode("generate_listing", copyNode)
  .addEdge(START, "vision_extract")
  .addEdge("vision_extract", "comp_search")
  .addEdge("comp_search", "generate_listing")
  .addEdge("generate_listing", END)
  .compile();

export async function runLister(listing: Listing): Promise<Listing> {
  clearCancel(listing.id);
  markAgentRunning(listing.id);
  await updateListing(listing.id, {
    status: "analyzing",
    pipeline_stage: "Starting Lister Agent",
    pipeline_error: null,
  });
  await logAgent(
    listing.id,
    "lister",
    "START",
    "Lister Agent started: identify the item from photos → price it on marketplaces → write the listing."
  );
  try {
    await listerGraph.invoke({
      listingId: listing.id,
      photos: listing.photos,
      hints: listing.hints,
    });
  } catch (error) {
    if (isAgentCancelled(error)) {
      const latest = await getListing(listing.id);
      await updateListing(listing.id, {
        status: latest?.title ? "ready" : "draft",
        pipeline_stage: "Stopped",
        pipeline_error: null,
      });
      await logAgent(listing.id, "lister", "STOPPED", "You stopped the lister.");
      clearCancel(listing.id);
      return (await getListing(listing.id)) || listing;
    }
    await updateListing(listing.id, {
      status: "error",
      pipeline_stage: "Failed",
      pipeline_error: error instanceof Error ? error.message : "Lister failed",
    });
    await logAgent(
      listing.id,
      "lister",
      "ERROR",
      error instanceof Error ? error.message : "Lister failed"
    );
    throw error;
  } finally {
    markAgentIdle(listing.id);
  }
  const next = await getListing(listing.id);
  if (!next) throw new Error("Listing disappeared during lister run");
  return next;
}

const NegotiatorState = Annotation.Root({
  listing: Annotation<Listing>(),
  history: Annotation<Message[]>(),
  inbound: Annotation<string>(),
  result: Annotation<NegotiatorResult | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

async function negotiatorNode(state: typeof NegotiatorState.State) {
  await logAgent(
    state.listing.id,
    "negotiator",
    "THINK",
    `Reading buyer message: “${state.inbound.slice(0, 80)}”`
  );
  const result = await negotiate(state);
  await logAgent(
    state.listing.id,
    "negotiator",
    result.action.toUpperCase(),
    result.decision || result.escalate_reason || result.reply_text
  );
  return { result };
}

const negotiatorGraph = new StateGraph(NegotiatorState)
  .addNode("negotiator_agent", negotiatorNode)
  .addEdge(START, "negotiator_agent")
  .addEdge("negotiator_agent", END)
  .compile();

export async function runNegotiator(
  listing: Listing,
  inbound: string
): Promise<NegotiatorResult> {
  const history = await listMessages(listing.id);
  const output = await negotiatorGraph.invoke({
    listing,
    history,
    inbound,
  });
  if (!output.result) {
    throw new Error("Negotiator returned no result");
  }
  return output.result;
}
