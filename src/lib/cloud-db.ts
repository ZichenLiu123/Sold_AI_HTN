import { getStore, type Store } from "@netlify/blobs";
import { attachPostUrls } from "./platforms";
import { emptySellerProfile } from "./profile";
import { sellerId } from "./seller-context";
import type {
  AgentEvent,
  AgentName,
  Listing,
  Message,
  Platform,
  PlatformConnection,
  SellerProfile,
} from "./types";

function store(): Store {
  return getStore({ name: "sold", consistency: "strong" });
}

function listingKey(id: string) {
  return `listing/${id}`;
}
function eventsKey(id: string) {
  return `events/${id}`;
}
function messagesKey(id: string) {
  return `messages/${id}`;
}
function connKey(userId: string, platform: Platform) {
  return `conn/${userId}/${platform}`;
}
function profileKey(userId: string) {
  return `profile/${userId}`;
}
function photoKey(name: string) {
  return `photo/${name}`;
}

const INDEX = "index/listings";

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const value = await store().get(key, { type: "json" });
  return (value as T | null) ?? fallback;
}

async function listingIds(): Promise<string[]> {
  return readJson<string[]>(INDEX, []);
}

async function withLastEvent(listing: Listing): Promise<Listing> {
  const events = await listEvents(listing.id);
  return attachPostUrls({
    ...listing,
    last_event: events[events.length - 1] || null,
  });
}

export async function listPlatformConnections(
  userId: string
): Promise<PlatformConnection[]> {
  const listed = await store().list({ prefix: `conn/${userId}/` });
  const rows = await Promise.all(
    listed.blobs.map((blob) => store().get(blob.key, { type: "json" }))
  );
  return rows.filter(Boolean) as PlatformConnection[];
}

export async function getPlatformConnection(
  userId: string,
  platform: Platform
): Promise<PlatformConnection | null> {
  return readJson<PlatformConnection | null>(connKey(userId, platform), null);
}

export async function upsertPlatformConnection(
  connection: PlatformConnection
): Promise<PlatformConnection> {
  await store().setJSON(connKey(connection.user_id, connection.platform), connection);
  return connection;
}

export async function getSellerProfile(userId = sellerId()): Promise<SellerProfile> {
  return readJson(profileKey(userId), emptySellerProfile(userId));
}

export async function upsertSellerProfile(profile: SellerProfile): Promise<SellerProfile> {
  const next = { ...emptySellerProfile(profile.user_id), ...profile, updated_at: new Date().toISOString() };
  await store().setJSON(profileKey(next.user_id), next);
  return next;
}

export async function listListings(): Promise<Listing[]> {
  const uid = sellerId();
  const ids = await listingIds();
  const listings = await Promise.all(ids.map((id) => getListing(id)));
  return listings.filter(
    (listing): listing is Listing =>
      listing !== null && listing.user_id === uid
  );
}

export async function getListing(id: string): Promise<Listing | null> {
  const listing = await store().get(listingKey(id), { type: "json" });
  if (!listing) return null;
  return withLastEvent(listing as Listing);
}

export async function insertListing(listing: Listing): Promise<Listing> {
  const next = {
    ...listing,
    user_id: listing.user_id || sellerId(),
  };
  await store().setJSON(listingKey(next.id), next);
  const ids = await listingIds();
  await store().setJSON(INDEX, [next.id, ...ids.filter((id) => id !== next.id)]);
  return withLastEvent(next);
}

export async function updateListing(
  id: string,
  patch: Partial<Listing>
): Promise<Listing | null> {
  const current = await store().get(listingKey(id), { type: "json" });
  if (!current) return null;
  const next = { ...(current as Listing), ...patch };
  await store().setJSON(listingKey(id), next);
  return withLastEvent(next);
}

export async function deleteListing(id: string): Promise<boolean> {
  const current = await store().get(listingKey(id), { type: "json" });
  if (!current) return false;
  await store().delete(listingKey(id));
  await store().delete(eventsKey(id));
  await store().delete(messagesKey(id));
  const ids = await listingIds();
  await store().setJSON(
    INDEX,
    ids.filter((entry) => entry !== id)
  );
  return true;
}

export async function listMessages(listingId: string): Promise<Message[]> {
  return readJson<Message[]>(messagesKey(listingId), []);
}

export async function insertMessage(message: Message): Promise<Message> {
  const messages = await listMessages(message.listing_id);
  messages.push(message);
  await store().setJSON(messagesKey(message.listing_id), messages);
  return message;
}

export async function listEvents(listingId: string): Promise<AgentEvent[]> {
  return readJson<AgentEvent[]>(eventsKey(listingId), []);
}

export async function lastEvent(listingId: string): Promise<AgentEvent | null> {
  const events = await listEvents(listingId);
  return events[events.length - 1] || null;
}

export async function logAgent(
  listingId: string,
  agent: AgentName,
  action: string,
  detail: string
): Promise<AgentEvent> {
  const event: AgentEvent = {
    id: crypto.randomUUID(),
    listing_id: listingId,
    agent,
    action,
    detail,
    timestamp: new Date().toISOString(),
  };
  const events = await listEvents(listingId);
  events.push(event);
  await store().setJSON(eventsKey(listingId), events);
  return event;
}

export async function putPhoto(name: string, body: Buffer | Uint8Array) {
  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  await store().set(photoKey(name), copy, {
    metadata: { contentType: "application/octet-stream" },
  });
}

export async function getPhoto(name: string): Promise<Uint8Array | null> {
  try {
    const value = await store().get(photoKey(name), { type: "arrayBuffer" });
    return value ? new Uint8Array(value) : null;
  } catch {
    return null;
  }
}
