import assert from "node:assert/strict";
import test from "node:test";
import {
  emptySellerProfile,
  listingLocation,
  profileReadyForPosting,
  sellerDisplayName,
  sellerPickupLine,
  sellerPlace,
} from "../src/lib/profile.ts";

test("does not invent a pickup line from an empty profile", () => {
  const profile = emptySellerProfile();
  assert.equal(sellerPlace(profile), "");
  assert.equal(sellerPickupLine(profile), "");
  assert.equal(sellerDisplayName(profile), "You");
  assert.equal(profileReadyForPosting(profile), false);
});

test("builds pickup from city, neighborhood, zip, and notes", () => {
  const profile = {
    ...emptySellerProfile(),
    name: "Zach",
    city: "Brooklyn",
    neighborhood: "Park Slope",
    zip: "11215",
    pickup_notes: "weekends after 6",
  };
  assert.equal(sellerPlace(profile), "Park Slope, Brooklyn");
  assert.equal(
    sellerPickupLine(profile),
    "Park Slope, Brooklyn — 11215 — weekends after 6"
  );
  assert.equal(sellerDisplayName(profile), "Zach");
  assert.equal(profileReadyForPosting(profile), true);
});

test("listing location prefers the listing hint over the profile", () => {
  const profile = {
    ...emptySellerProfile(),
    city: "Brooklyn",
    zip: "11215",
  };
  assert.equal(
    listingLocation({ hints: { pickup_notes: "Greenpoint" } }, profile),
    "Greenpoint"
  );
  assert.equal(listingLocation({ hints: {} }, profile), "Brooklyn — 11215");
});
