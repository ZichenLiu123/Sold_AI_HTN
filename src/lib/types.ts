export const DEMO_USER = {
  id: "demo-seller",
};

export type SellerProfile = {
  user_id: string;
  name: string;
  city: string;
  neighborhood: string;
  zip: string;
  pickup_notes: string;
  updated_at: string;
};

export const PLATFORMS = [
  "Facebook Marketplace",
  "Kijiji",
  "Karrot",
  "OfferUp",
  "Craigslist",
  "Mercari",
  "Poshmark",
  "eBay",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export type ListingStatus =
  | "draft"
  | "analyzing"
  | "ready"
  | "posting"
  | "live"
  | "sold"
  | "rejected"
  | "error";

export type Sender = "buyer" | "agent" | "human";

export type NegotiatorAction =
  | "answer"
  | "counter"
  | "hold"
  | "accept"
  | "escalate";

export type ItemAttributes = {
  category: string;
  brand: string | null;
  model: string | null;
  condition: string;
  flaws: string[];
  color: string | null;
  notable_features: string[];
  visible_text: string[];
  /** Google/Shopping-ready phrase from vision — preferred over hand-built queries. */
  search_query?: string | null;
  confidence: "high" | "medium" | "low";
};

export type CompListing = {
  title: string;
  price: number;
  url: string;
  source: string;
  sold: boolean;
  quantity?: number;
  unit_price?: number;
  eval_note?: string;
};

export type CompSourceDiagnostic = {
  source: string;
  attempted: boolean;
  successful: boolean;
  attempts: number;
  found: number;
  reason: string | null;
  search_url?: string;
};

export type CompData = {
  source: string;
  sources: string[];
  query: string;
  comps: CompListing[];
  min: number | null;
  max: number | null;
  median: number | null;
  mocked: boolean;
  confidence?: "high" | "medium" | "low" | "none";
  failure_reason?: string | null;
  session_url?: string | null;
  attempted_sources?: string[];
  successful_sources?: string[];
  diagnostics?: CompSourceDiagnostic[];
  pricing_basis?: "sold" | "mixed" | "asking" | "none";
  evaluated?: boolean;
};

export type UserHints = {
  category?: string;
  condition?: string;
  asking_price?: number;
  brand?: string;
  reason_for_selling?: string;
  pickup_notes?: string;
  seller_notes?: string;
};

export type GeneratedListing = {
  title: string;
  description: string;
  suggested_price: number;
  price_reasoning: string;
  suggested_platforms: Platform[];
};

export type PlatformPost = {
  platform: Platform | "Gmail receipt";
  status:
    | "pending"
    | "connection_required"
    | "awaiting_user"
    | "posting"
    | "posted"
    | "failed"
    | "needs_attention"
    | "mocked";
  via: "composio" | "browserbase" | "mock";
  url?: string;
  remote_url?: string;
  remote_id?: string;
  session_url?: string;
  detail?: string;
  /** Facebook: submitted but not public yet vs a real Marketplace item URL. */
  remote_state?: "live" | "review";
  /** Last time Sold confirmed this post against the live marketplace. */
  checked_at?: string;
};

export type PlatformConnectionStatus =
  | "not_connected"
  | "awaiting_login"
  | "connected"
  | "expired"
  | "error";

export type PlatformConnection = {
  user_id: string;
  platform: Platform;
  context_id: string | null;
  session_id: string | null;
  status: PlatformConnectionStatus;
  created_at: string;
  updated_at: string;
  checked_at: string | null;
  error: string | null;
  metadata: Record<string, string>;
};

export type AgentName = "lister" | "browser" | "evaluator" | "negotiator" | "composio";

export type AgentEvent = {
  id: string;
  listing_id: string;
  agent: AgentName;
  action: string;
  detail: string;
  timestamp: string;
};

export type Listing = {
  id: string;
  /** Owning seller (Supabase auth user id). */
  user_id: string;
  photos: string[];
  title: string;
  description: string;
  price: number;
  floor_price: number;
  status: ListingStatus;
  platforms: Platform[];
  created_at: string;
  attributes: ItemAttributes | null;
  comps: CompData | null;
  price_reasoning: string;
  hints: UserHints;
  auto_post: boolean;
  platform_posts: PlatformPost[];
  pipeline_stage: string;
  pipeline_error: string | null;
  last_event: AgentEvent | null;
};

export type Message = {
  id: string;
  listing_id: string;
  conversation_id: string;
  buyer_name?: string;
  sender: Sender;
  text: string;
  action: NegotiatorAction | null;
  decision: string;
  escalate: boolean;
  escalate_reason: string;
  timestamp: string;
};

export type NegotiatorResult = {
  action: NegotiatorAction;
  reply_text: string;
  decision: string;
  escalate: boolean;
  escalate_reason: string;
};
