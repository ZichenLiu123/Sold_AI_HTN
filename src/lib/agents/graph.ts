import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { extractAttributes } from "./vision";
import { mergeCompData, searchComps, hasSoldPriceLock, relevanceTokens } from "./browser";
import { lookupOpenAIMarketPrice } from "./openai-price";
import { evaluateComps } from "./evaluator";
import { generateListingCopy } from "./lister";
import { negotiate } from "./negotiator";
import {
  chatgptMarketAvailable,
  identifyAndPriceFromPhotos,
} from "./chatgpt-market";
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
  chatgptPrice: Annotation<number | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  chatgptReasoning: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  generated: Annotation<GeneratedListing | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

function compsAreStrong(comps: CompData | null | undefined) {
  return Boolean(
    comps &&
      !comps.mocked &&
      comps.median != null &&
      comps.comps.length >= 3
  );
}

async function visionNode(state: typeof ListerState.State) {
  throwIfCancelled(state.listingId);
  await updateListing(state.listingId, {
    pipeline_stage: "Reading the photos",
    status: "analyzing",
  });

  // Primary path: vision + live web search in one tool-using call.
  // Browser scraping is only a comps fallback later.
  if (chatgptMarketAvailable()) {
    await logAgent(
      state.listingId,
      "lister",
      "VISION",
      "Sold Agent is identifying the item from photos and looking up live prices."
    );
    await updateListing(state.listingId, {
      pipeline_stage: "Sold Agent is identifying the item and searching prices…",
    });
    try {
      const market = await identifyAndPriceFromPhotos(state.photos, state.hints);
      throwIfCancelled(state.listingId);
      const previous = await getListing(state.listingId);
      if (!market.attributes.brand && previous?.attributes?.brand) {
        market.attributes.brand = previous.attributes.brand;
      }
      const brand = market.attributes.brand || "no brand visible";
      const model = market.attributes.model || "no model on the item";
      await logAgent(
        state.listingId,
        "lister",
        "VISION",
        `Sold Agent saw ${market.attributes.category} · ${brand} · ${model} · ${market.attributes.condition}${
          market.attributes.search_query
            ? ` · search “${market.attributes.search_query}”`
            : ""
        }.`
      );
      await logAgent(
        state.listingId,
        "browser",
        "COMPS",
        market.comps.median != null
          ? `Web comps: ${market.comps.comps.length} listings, median $${market.comps.median}. ${market.price_reasoning || ""}`.trim()
          : `Sold Agent identified the item but comps were thin (${market.comps.comps.length}). May scrape Google next.`
      );
      await updateListing(state.listingId, {
        attributes: market.attributes,
        comps: market.comps,
        pipeline_stage: compsAreStrong(market.comps)
          ? "Sold Agent priced the item"
          : "Photos read — need more comps",
        ...(market.price_reasoning
          ? { price_reasoning: market.price_reasoning }
          : {}),
      });
      return {
        attributes: market.attributes,
        comps: market.comps,
        chatgptPrice: market.suggested_price || null,
        chatgptReasoning: market.price_reasoning || null,
      };
    } catch (error) {
      await logAgent(
        state.listingId,
        "lister",
        "VISION",
        `Sold Agent market lookup failed (${error instanceof Error ? error.message : "error"}). Falling back to photo-only vision.`
      );
    }
  }

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
    }${
      attributes.search_query ? ` · Google: “${attributes.search_query}”` : ""
    }.`
  );
  await updateListing(state.listingId, { attributes, pipeline_stage: "Photos read" });
  return { attributes };
}

async function compsNode(state: typeof ListerState.State) {
  throwIfCancelled(state.listingId);
  if (compsAreStrong(state.comps)) {
    const comps = state.comps!;
    const { writePriceCache } = await import("../marketplace/price-cache");
    if (comps.query) writePriceCache(comps.query, comps);
    await updateListing(state.listingId, {
      comps,
      pipeline_stage: "Comps in",
    });
    await logAgent(
      state.listingId,
      "browser",
      "COMPS",
      `Using Sold Agent web comps for “${comps.query}”: median $${comps.median}. Skipped a browser scrape.`
    );
    return { comps };
  }

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
  const googleQuery =
    attributes.search_query ||
    identity ||
    [attributes.color, attributes.category].filter(Boolean).join(" ");
  const { readPriceCache, writePriceCache } = await import("../marketplace/price-cache");
  const cached = googleQuery ? readPriceCache(googleQuery) : null;
  if (cached) {
    await updateListing(state.listingId, { comps: cached, pipeline_stage: "Comps in (cached)" });
    await logAgent(
      state.listingId,
      "browser",
      "COMPS",
      `Reused cached comps for “${googleQuery}”: median $${cached.median}.`
    );
    return { comps: cached };
  }
  await logAgent(
    state.listingId,
    "browser",
    "COMPS",
    googleQuery
      ? `Web comps were thin — scraping Google Shopping + eBay sold for “${googleQuery}”.`
      : "No search query yet. Falling back to a visual description across marketplaces."
  );
  const live = await searchComps(attributes, {
    onSession: async () => {
      await updateListing(state.listingId, {
        pipeline_stage: "Google Shopping is open. Pricing the item…",
      });
      await logAgent(
        state.listingId,
        "browser",
        "COMPS",
        `Browserbase session opened. Searching Google for “${googleQuery}”.`
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
  const prior = state.comps;
  const tokens = relevanceTokens(attributes);
  const withChat =
    prior && prior.comps.length
      ? mergeCompData(live, prior, tokens.any, tokens.all)
      : live;
  const web =
    (identity || attributes.search_query) && !hasSoldPriceLock(withChat)
      ? await lookupOpenAIMarketPrice(attributes).catch(() => null)
      : null;
  const merged = web
    ? mergeCompData(withChat, web, tokens.any, tokens.all)
    : withChat;
  await updateListing(state.listingId, {
    pipeline_stage: "Checking if those prices are actually comparable",
  });
  const soldLocked = hasSoldPriceLock(merged);
  await logAgent(
    state.listingId,
    "lister",
    "PRICE",
    soldLocked
      ? "Sold comps already lock the price. Applying pack/variant checks without another pass."
      : "Checking whether each hit is the same product and converting packs to a per-item price."
  );
  const comps = await evaluateComps(attributes, merged, { llm: !soldLocked });
  const kept = comps.comps.length;
  const packs = comps.comps.filter((comp) => (comp.quantity || 1) > 1).length;
  await updateListing(state.listingId, { comps, pipeline_stage: "Comps in" });
  if (googleQuery && comps.median != null && !comps.mocked) {
    writePriceCache(googleQuery, comps);
  }
  const range =
    comps.median != null
      ? `${comps.min}–${comps.max} (median ${comps.median})`
      : "no usable unit price";
  await logAgent(
    state.listingId,
    "lister",
    "PRICE",
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
  // Prefer Sold Agent's suggested ask when comps support it; never invent if both empty.
  const fromChat =
    state.chatgptPrice && state.chatgptPrice > 0 ? state.chatgptPrice : null;
  const fromComps =
    state.comps?.median != null && state.comps.median > 0
      ? roundClean(state.comps.median)
      : null;
  const price =
    generated.suggested_price > 0
      ? generated.suggested_price
      : fromChat || fromComps || 0;
  const floor = price > 0 ? roundClean(price * 0.8) : 0;
  const reasoning =
    state.chatgptReasoning ||
    generated.price_reasoning ||
    (fromComps ? `Priced from verified comps (median $${fromComps}).` : "");
  await updateListing(state.listingId, {
    title: generated.title,
    description: generated.description,
    price,
    floor_price: floor,
    platforms: generated.suggested_platforms,
    price_reasoning: reasoning,
    status: "ready",
    pipeline_stage: "Needs your review",
    pipeline_error: null,
  });
  await logAgent(
    state.listingId,
    "lister",
    "COPY",
    price > 0
      ? `Suggested $${price} (floor $${floor}, hidden). ${reasoning} Platforms: ${generated.suggested_platforms.join(", ")}.`
      : `Drafted without a price. ${reasoning} Platforms: ${generated.suggested_platforms.join(", ")}.`
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
    "Lister Agent started: identify the item from photos → look up live prices → write the listing."
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
