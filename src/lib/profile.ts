import type { Listing, SellerProfile } from "./types";

export function emptySellerProfile(userId = "demo-seller"): SellerProfile {
  return {
    user_id: userId,
    name: "",
    city: "",
    neighborhood: "",
    zip: "",
    pickup_notes: "",
    updated_at: new Date().toISOString(),
  };
}

export function sellerDisplayName(profile: SellerProfile) {
  return profile.name.trim() || "You";
}

export function sellerPlace(profile: SellerProfile) {
  return [profile.neighborhood.trim(), profile.city.trim()]
    .filter(Boolean)
    .join(", ");
}

export function sellerPickupLine(profile: SellerProfile) {
  return [sellerPlace(profile), profile.zip.trim(), profile.pickup_notes.trim()]
    .filter(Boolean)
    .join(" — ");
}

export function listingLocation(listing: Pick<Listing, "hints">, profile: SellerProfile) {
  return listing.hints?.pickup_notes?.trim() || sellerPickupLine(profile);
}

export function profileReadyForPosting(profile: SellerProfile) {
  return Boolean(profile.city.trim() || profile.zip.trim());
}
