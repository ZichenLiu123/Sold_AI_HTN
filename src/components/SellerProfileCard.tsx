"use client";

import { useEffect, useState } from "react";
import type { SellerProfile } from "@/lib/types";
import { emptySellerProfile, profileReadyForPosting } from "@/lib/profile";

export function SellerProfileCard() {
  const [profile, setProfile] = useState<SellerProfile>(emptySellerProfile());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/profile", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setProfile({ ...emptySellerProfile(), ...data }))
      .catch(() => setError("Could not load profile."))
      .finally(() => setLoading(false));
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

  const ready = profileReadyForPosting(profile);

  return (
    <form onSubmit={(event) => void save(event)} className="panel px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-semibold tracking-tight text-ink">
          Seller profile
        </p>
        <span className={`stamp ${ready ? "badge-live" : "badge-submitted"}`}>
          {loading ? "…" : ready ? "Ready" : "Needed"}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-grey">
        Used on marketplace posts. Sold only uses what you save here — it will not
        invent an address.
      </p>
      <div className="mt-4 grid gap-3">
        <label className="field">
          Name
          <input
            key={`name:${profile.name}`}
            name="name"
            defaultValue={profile.name}
            placeholder="how buyers should know you"
            disabled={loading}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            City
            <input
              key={`city:${profile.city}`}
              name="city"
              defaultValue={profile.city}
              placeholder="Toronto"
              disabled={loading}
            />
          </label>
          <label className="field">
            Postal code
            <input
              key={`zip:${profile.zip}`}
              name="zip"
              defaultValue={profile.zip}
              placeholder="M5V 2T6"
              disabled={loading}
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
            disabled={loading}
          />
        </label>
        <label className="field">
          Pickup
          <input
            key={`pickup:${profile.pickup_notes}`}
            name="pickup_notes"
            defaultValue={profile.pickup_notes}
            placeholder="weekends, lobby, after 6…"
            disabled={loading}
          />
        </label>
      </div>
      {error ? <p className="mt-3 text-[13px] text-stamp">{error}</p> : null}
      {saved ? <p className="mt-3 text-[13px] text-ledger">Saved.</p> : null}
      {!ready && !loading ? (
        <p className="mt-3 text-[12px] text-grey">
          Add a city and postal code before Sold can post.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || loading}
        className="btn-primary mt-4 h-10 w-full text-[13px]"
      >
        {busy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
