import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { isAgentRunning, stoppedListingPatch } from "./agents/cancel";
import { attachPostUrls } from "./platforms";
import { dataDir, isEphemeralFs } from "./storage";
import { emptySellerProfile } from "./profile";
import { PLATFORMS } from "./types";
import { sellerId } from "./seller-context";
import type {
  AgentEvent,
  AgentName,
  CompData,
  ItemAttributes,
  Listing,
  ListingStatus,
  Message,
  NegotiatorAction,
  Platform,
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformPost,
  SellerProfile,
  Sender,
  UserHints,
} from "./types";

type ListingRow = {
  id: string;
  user_id: string;
  photos: string;
  title: string;
  description: string;
  price: number;
  floor_price: number;
  status: string;
  platforms: string;
  created_at: string;
  attributes: string | null;
  comps: string | null;
  price_reasoning: string;
  hints: string;
  auto_post: number;
  platform_posts: string;
  pipeline_stage: string;
  pipeline_error: string | null;
};

type MessageRow = {
  id: string;
  listing_id: string;
  conversation_id: string;
  buyer_name?: string | null;
  sender: string;
  text: string;
  action: string | null;
  escalate: number;
  escalate_reason: string;
  decision: string | null;
  timestamp: string;
};

type EventRow = {
  id: string;
  listing_id: string;
  agent: string;
  action: string;
  detail: string;
  timestamp: string;
};

const globalForDb = globalThis as unknown as {
  soldDb?: DatabaseSync;
  soldSchema?: number;
};

const SCHEMA = 5;

function openDb(): DatabaseSync {
  if (!globalForDb.soldDb) {
    const dir = dataDir();
    globalForDb.soldDb = new DatabaseSync(path.join(dir, "sold.db"));
  }
  if (globalForDb.soldSchema !== SCHEMA) {
    migrate(globalForDb.soldDb);
    globalForDb.soldSchema = SCHEMA;
  }
  return globalForDb.soldDb;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'demo-seller',
      photos TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      floor_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      platforms TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attributes TEXT,
      comps TEXT,
      price_reasoning TEXT NOT NULL DEFAULT '',
      hints TEXT NOT NULL,
      auto_post INTEGER NOT NULL DEFAULT 0,
      platform_posts TEXT NOT NULL,
      pipeline_stage TEXT NOT NULL DEFAULT '',
      pipeline_error TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      action TEXT,
      escalate INTEGER NOT NULL DEFAULT 0,
      escalate_reason TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_connections (
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      context_id TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'not_connected',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      checked_at TEXT,
      error TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (user_id, platform)
    );

    CREATE TABLE IF NOT EXISTS seller_profiles (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      neighborhood TEXT NOT NULL DEFAULT '',
      zip TEXT NOT NULL DEFAULT '',
      pickup_notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);

  const messageCols = db
    .prepare("PRAGMA table_info(messages)")
    .all() as { name: string }[];
  if (!messageCols.some((col) => col.name === "decision")) {
    db.exec(
      "ALTER TABLE messages ADD COLUMN decision TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!messageCols.some((col) => col.name === "buyer_name")) {
    db.exec("ALTER TABLE messages ADD COLUMN buyer_name TEXT");
  }

  const listingCols = db
    .prepare("PRAGMA table_info(listings)")
    .all() as { name: string }[];
  if (!listingCols.some((col) => col.name === "user_id")) {
    db.exec(
      "ALTER TABLE listings ADD COLUMN user_id TEXT NOT NULL DEFAULT 'demo-seller'"
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS listings_user_id_idx ON listings(user_id)"
    );
  }
}

type ConnectionRow = {
  user_id: string;
  platform: string;
  context_id: string | null;
  session_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  checked_at: string | null;
  error: string | null;
  metadata: string;
};

function mapConnection(row: ConnectionRow): PlatformConnection {
  return {
    ...row,
    platform: row.platform as Platform,
    status: row.status as PlatformConnectionStatus,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, string>,
  };
}

export function listPlatformConnectionsSync(userId: string): PlatformConnection[] {
  return (
    openDb()
      .prepare("SELECT * FROM platform_connections WHERE user_id = ? ORDER BY platform")
      .all(userId) as ConnectionRow[]
  ).map(mapConnection);
}

export function getPlatformConnectionSync(
  userId: string,
  platform: Platform
): PlatformConnection | null {
  const row = openDb()
    .prepare("SELECT * FROM platform_connections WHERE user_id = ? AND platform = ?")
    .get(userId, platform) as ConnectionRow | undefined;
  return row ? mapConnection(row) : null;
}

export function upsertPlatformConnectionSync(
  connection: PlatformConnection
): PlatformConnection {
  openDb()
    .prepare(
      `INSERT INTO platform_connections (
        user_id, platform, context_id, session_id, status, created_at,
        updated_at, checked_at, error, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        context_id = excluded.context_id,
        session_id = excluded.session_id,
        status = excluded.status,
        updated_at = excluded.updated_at,
        checked_at = excluded.checked_at,
        error = excluded.error,
        metadata = excluded.metadata`
    )
    .run(
      connection.user_id,
      connection.platform,
      connection.context_id,
      connection.session_id,
      connection.status,
      connection.created_at,
      connection.updated_at,
      connection.checked_at,
      connection.error,
      JSON.stringify(connection.metadata)
    );
  return getPlatformConnectionSync(connection.user_id, connection.platform)!;
}

function mapListing(row: ListingRow): Listing {
  return {
    id: row.id,
    user_id: row.user_id || "demo-seller",
    photos: JSON.parse(row.photos) as string[],
    title: row.title,
    description: row.description,
    price: row.price,
    floor_price: row.floor_price,
    status: row.status as ListingStatus,
    platforms: (JSON.parse(row.platforms) as string[]).filter((platform): platform is Platform =>
      (PLATFORMS as readonly string[]).includes(platform)
    ),
    created_at: row.created_at,
    attributes: row.attributes
      ? (() => {
          const parsed = JSON.parse(row.attributes) as ItemAttributes;
          return {
            ...parsed,
            visible_text: Array.isArray(parsed.visible_text)
              ? parsed.visible_text
              : [],
          };
        })()
      : null,
    comps: row.comps
      ? (() => {
          const parsed = JSON.parse(row.comps) as CompData;
          return {
            ...parsed,
            sources: parsed.sources?.length
              ? parsed.sources
              : parsed.source
                ? [parsed.source]
                : [],
          };
        })()
      : null,
    price_reasoning: row.price_reasoning,
    hints: JSON.parse(row.hints) as UserHints,
    auto_post: Boolean(row.auto_post),
    platform_posts: JSON.parse(row.platform_posts) as PlatformPost[],
    pipeline_stage: row.pipeline_stage,
    pipeline_error: row.pipeline_error,
    last_event: lastEventSync(row.id),
  };
}

function mappedListing(row: ListingRow): Listing {
  return attachPostUrls(mapListing(row));
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    listing_id: row.listing_id,
    conversation_id: row.conversation_id,
    buyer_name: row.buyer_name || undefined,
    sender: row.sender as Sender,
    text: row.text,
    action: row.action as NegotiatorAction | null,
    escalate: Boolean(row.escalate),
    escalate_reason: row.escalate_reason,
    decision: row.decision || row.escalate_reason || "",
    timestamp: row.timestamp,
  };
}

function loadListingSync(id: string): Listing | null {
  const row = openDb()
    .prepare("SELECT * FROM listings WHERE id = ?")
    .get(id) as ListingRow | undefined;
  if (!row) return null;
  const listing = mappedListing(row);
  ensureEvents(listing);
  return mappedListing(row);
}

function settleStopping(listing: Listing): Listing {
  if (!/^stopping/i.test(listing.pipeline_stage || "")) return listing;
  if (isAgentRunning(listing.id)) return listing;
  return updateListingSync(listing.id, stoppedListingPatch(listing)) || listing;
}

function ownsListing(listing: Listing, userId = sellerId()): boolean {
  return listing.user_id === userId;
}

/** True when the active seller owns this listing. */
export function listingOwnedBySeller(listing: Listing, userId?: string): boolean {
  return ownsListing(listing, userId ?? sellerId());
}

export function listListingsSync(): Listing[] {
  const userId = sellerId();
  const rows = openDb()
    .prepare(
      "SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(userId) as ListingRow[];
  return rows.map((row) => {
    const listing = mappedListing(row);
    ensureEvents(listing);
    return settleStopping(mappedListing(row));
  });
}

export function getListingSync(id: string): Listing | null {
  const listing = loadListingSync(id);
  return listing ? settleStopping(listing) : null;
}

export function insertListingSync(listing: Listing): Listing {
  const user_id = listing.user_id || sellerId();
  openDb()
    .prepare(
      `INSERT INTO listings (
        id, user_id, photos, title, description, price, floor_price, status, platforms,
        created_at, attributes, comps, price_reasoning, hints, auto_post,
        platform_posts, pipeline_stage, pipeline_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      listing.id,
      user_id,
      JSON.stringify(listing.photos),
      listing.title,
      listing.description,
      listing.price,
      listing.floor_price,
      listing.status,
      JSON.stringify(listing.platforms),
      listing.created_at,
      listing.attributes ? JSON.stringify(listing.attributes) : null,
      listing.comps ? JSON.stringify(listing.comps) : null,
      listing.price_reasoning,
      JSON.stringify(listing.hints),
      listing.auto_post ? 1 : 0,
      JSON.stringify(listing.platform_posts),
      listing.pipeline_stage,
      listing.pipeline_error
    );
  return { ...listing, user_id };
}

export function updateListingSync(
  id: string,
  patch: Partial<Listing>
): Listing | null {
  const current = loadListingSync(id);
  if (!current) return null;
  const next: Listing = { ...current, ...patch };
  openDb()
    .prepare(
      `UPDATE listings SET
        photos = ?, title = ?, description = ?, price = ?, floor_price = ?,
        status = ?, platforms = ?, attributes = ?, comps = ?, price_reasoning = ?,
        hints = ?, auto_post = ?, platform_posts = ?, pipeline_stage = ?,
        pipeline_error = ?
      WHERE id = ?`
    )
    .run(
      JSON.stringify(next.photos),
      next.title,
      next.description,
      next.price,
      next.floor_price,
      next.status,
      JSON.stringify(next.platforms),
      next.attributes ? JSON.stringify(next.attributes) : null,
      next.comps ? JSON.stringify(next.comps) : null,
      next.price_reasoning,
      JSON.stringify(next.hints),
      next.auto_post ? 1 : 0,
      JSON.stringify(next.platform_posts),
      next.pipeline_stage,
      next.pipeline_error,
      id
    );
  return attachPostUrls(next);
}

export function deleteListingSync(id: string): boolean {
  const db = openDb();
  const existing = db.prepare("SELECT id FROM listings WHERE id = ?").get(id);
  if (!existing) return false;
  db.prepare("DELETE FROM messages WHERE listing_id = ?").run(id);
  db.prepare("DELETE FROM events WHERE listing_id = ?").run(id);
  db.prepare("DELETE FROM listings WHERE id = ?").run(id);
  return true;
}

export function listMessagesSync(listingId: string): Message[] {
  const rows = openDb()
    .prepare(
      "SELECT * FROM messages WHERE listing_id = ? ORDER BY timestamp ASC"
    )
    .all(listingId) as MessageRow[];
  return rows.map(mapMessage);
}

export function insertMessageSync(message: Message): Message {
  openDb()
    .prepare(
      `INSERT INTO messages (
        id, listing_id, conversation_id, buyer_name, sender, text, action, escalate,
        escalate_reason, decision, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      message.listing_id,
      message.conversation_id,
      message.buyer_name || null,
      message.sender,
      message.text,
      message.action,
      message.escalate ? 1 : 0,
      message.escalate_reason,
      message.decision,
      message.timestamp
    );
  return message;
}

function mapEvent(row: EventRow): AgentEvent {
  return {
    id: row.id,
    listing_id: row.listing_id,
    agent: row.agent as AgentName,
    action: row.action,
    detail: row.detail,
    timestamp: row.timestamp,
  };
}

export function listEventsSync(listingId: string): AgentEvent[] {
  const rows = openDb()
    .prepare(
      "SELECT * FROM events WHERE listing_id = ? ORDER BY timestamp ASC"
    )
    .all(listingId) as EventRow[];
  return rows.map(mapEvent);
}

export function lastEventSync(listingId: string): AgentEvent | null {
  const row = openDb()
    .prepare(
      "SELECT * FROM events WHERE listing_id = ? ORDER BY timestamp DESC LIMIT 1"
    )
    .get(listingId) as EventRow | undefined;
  return row ? mapEvent(row) : null;
}

export function logAgentSync(
  listingId: string,
  agent: AgentName,
  action: string,
  detail: string
): AgentEvent {
  const event: AgentEvent = {
    id: crypto.randomUUID(),
    listing_id: listingId,
    agent,
    action,
    detail,
    timestamp: new Date().toISOString(),
  };
  openDb()
    .prepare(
      `INSERT INTO events (id, listing_id, agent, action, detail, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.listing_id,
      event.agent,
      event.action,
      event.detail,
      event.timestamp
    );
  return event;
}

function ensureEvents(listing: Listing) {
  if (listEventsSync(listing.id).length > 0) return;
  if (listing.photos.length) {
    logAgentSync(
      listing.id,
      "lister",
      "QUEUED",
      "Photo was uploaded."
    );
  }
  if (listing.attributes) {
    const brand = listing.attributes.brand || "no brand visible";
    logAgentSync(
      listing.id,
      "lister",
      "VISION",
      `Saw ${listing.attributes.category} · ${brand} · ${listing.attributes.condition}.`
    );
  }
  if (listing.comps) {
    const range =
      listing.comps.median != null
        ? `median $${listing.comps.median}`
        : "no prices";
    logAgentSync(
      listing.id,
      "browser",
      "COMPS",
      `${listing.comps.mocked ? "Estimated" : "Live"} comps: ${range}.`
    );
  }
  if (listing.title) {
    logAgentSync(
      listing.id,
      "lister",
      "COPY",
      `Wrote “${listing.title}” at $${listing.price}. ${listing.price_reasoning}`
    );
  }
  if (listing.status === "live" || listing.status === "sold") {
    logAgentSync(
      listing.id,
      "composio",
      "LIVE",
      "Listing was marked live."
    );
  }
}

async function cloud() {
  return import("./cloud-db");
}

type ProfileRow = {
  user_id: string;
  name: string;
  city: string;
  neighborhood: string;
  zip: string;
  pickup_notes: string;
  updated_at: string;
};

export function getSellerProfileSync(userId = sellerId()): SellerProfile {
  const row = openDb()
    .prepare("SELECT * FROM seller_profiles WHERE user_id = ?")
    .get(userId) as ProfileRow | undefined;
  return row || emptySellerProfile(userId);
}

export function upsertSellerProfileSync(profile: SellerProfile): SellerProfile {
  const next: SellerProfile = {
    ...emptySellerProfile(profile.user_id),
    ...profile,
    updated_at: new Date().toISOString(),
  };
  openDb()
    .prepare(
      `INSERT INTO seller_profiles (
        user_id, name, city, neighborhood, zip, pickup_notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        name = excluded.name,
        city = excluded.city,
        neighborhood = excluded.neighborhood,
        zip = excluded.zip,
        pickup_notes = excluded.pickup_notes,
        updated_at = excluded.updated_at`
    )
    .run(
      next.user_id,
      next.name,
      next.city,
      next.neighborhood,
      next.zip,
      next.pickup_notes,
      next.updated_at
    );
  return next;
}

export async function getSellerProfile(userId = sellerId()) {
  return isEphemeralFs()
    ? (await cloud()).getSellerProfile(userId)
    : getSellerProfileSync(userId);
}

export async function upsertSellerProfile(profile: SellerProfile) {
  return isEphemeralFs()
    ? (await cloud()).upsertSellerProfile(profile)
    : upsertSellerProfileSync(profile);
}

export async function listPlatformConnections(userId: string) {
  return isEphemeralFs()
    ? (await cloud()).listPlatformConnections(userId)
    : listPlatformConnectionsSync(userId);
}

export async function getPlatformConnection(
  userId: string,
  platform: Platform
) {
  return isEphemeralFs()
    ? (await cloud()).getPlatformConnection(userId, platform)
    : getPlatformConnectionSync(userId, platform);
}

export async function upsertPlatformConnection(connection: PlatformConnection) {
  return isEphemeralFs()
    ? (await cloud()).upsertPlatformConnection(connection)
    : upsertPlatformConnectionSync(connection);
}

export async function listListings() {
  return isEphemeralFs()
    ? (await cloud()).listListings()
    : listListingsSync();
}

export async function getListing(id: string) {
  return isEphemeralFs()
    ? (await cloud()).getListing(id)
    : getListingSync(id);
}

export async function insertListing(listing: Listing) {
  return isEphemeralFs()
    ? (await cloud()).insertListing(listing)
    : insertListingSync(listing);
}

export async function updateListing(id: string, patch: Partial<Listing>) {
  return isEphemeralFs()
    ? (await cloud()).updateListing(id, patch)
    : updateListingSync(id, patch);
}

export async function deleteListing(id: string) {
  return isEphemeralFs()
    ? (await cloud()).deleteListing(id)
    : deleteListingSync(id);
}

export async function listMessages(listingId: string) {
  return isEphemeralFs()
    ? (await cloud()).listMessages(listingId)
    : listMessagesSync(listingId);
}

export async function insertMessage(message: Message) {
  return isEphemeralFs()
    ? (await cloud()).insertMessage(message)
    : insertMessageSync(message);
}

export async function listEvents(listingId: string) {
  return isEphemeralFs()
    ? (await cloud()).listEvents(listingId)
    : listEventsSync(listingId);
}

export async function lastEvent(listingId: string) {
  return isEphemeralFs()
    ? (await cloud()).lastEvent(listingId)
    : lastEventSync(listingId);
}

export async function logAgent(
  listingId: string,
  agent: AgentName,
  action: string,
  detail: string
) {
  return isEphemeralFs()
    ? (await cloud()).logAgent(listingId, agent, action, detail)
    : logAgentSync(listingId, agent, action, detail);
}

