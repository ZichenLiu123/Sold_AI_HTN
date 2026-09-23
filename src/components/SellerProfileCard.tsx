"use client";

import { useEffect, useState } from "react";
import type { SellerProfile } from "@/lib/types";
import { emptySellerProfile, profileReadyForPosting } from "@/lib/profile";

export function SellerProfileCard() {
  const [profile, setProfile] = useState<SellerProfile>(emptySellerProfile());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/profile", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setProfile({ ...emptySellerProfile(), ...data }))
      .catch(() => setError("Could not load profile."));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          city: form.get("city"),
          neighborhood: form.get("neighborhood"),
          zip: form.get("zip"),
          pickup_notes: form.get("pickup_notes"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save profile.");
      setProfile(data);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="panel px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-semibold tracking-tight text-ink">Seller profile</p>
        <span
          className={`stamp ${
            profileReadyForPosting(profile) ? "badge-live" : "badge-submitted"
          }`}
        >
          {profileReadyForPosting(profile) ? "Ready" : "Needed"}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-grey">
        City, ZIP, and pickup notes for posts. Sold will not invent an address.
      </p>
      <div className="mt-4 grid gap-3">
        <label className="field">
          Name
          <input
            key={`name:${profile.name}`}
            name="name"
            defaultValue={profile.name}
            placeholder="how buyers should know you"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            City
            <input
              key={`city:${profile.city}`}
              name="city"
              defaultValue={profile.city}
              placeholder="Brooklyn"
            />
          </label>
          <label className="field">
            ZIP
            <input
              key={`zip:${profile.zip}`}
              name="zip"
              defaultValue={profile.zip}
              placeholder="11215"
            />
          </label>
        </div>
        <label className="field">
          Neighborhood
          <input
            key={`neighborhood:${profile.neighborhood}`}
            name="neighborhood"
            defaultValue={profile.neighborhood}
            placeholder="optional"
          />
        </label>
        <label className="field">
          Pickup
          <input
            key={`pickup:${profile.pickup_notes}`}
            name="pickup_notes"
            defaultValue={profile.pickup_notes}
            placeholder="weekends, sidewalk, after 6…"
          />
        </label>
      </div>
      {error && <p className="mt-3 text-[13px] text-stamp">{error}</p>}
      {saved && <p className="mt-3 text-[13px] text-ledger">Saved.</p>}
      <button type="submit" disabled={busy} className="btn-primary mt-4 h-10 w-full text-[13px]">
        {busy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
