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
    <form onSubmit={(event) => void save(event)} className="rounded-2xl bg-card px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-serif text-xl">Profile</p>
        <span className={`stamp ${profileReadyForPosting(profile) ? "text-sage" : "text-gold"}`}>
          {profileReadyForPosting(profile) ? "ready" : "needed"}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink/60">
        Sold uses this city, ZIP, and pickup when it posts. It will not invent an
        address.
      </p>
      <div className="mt-3 grid gap-3">
        <Field name="name" label="Name" defaultValue={profile.name} placeholder="how buyers should know you" />
        <div className="grid grid-cols-2 gap-3">
          <Field name="city" label="City" defaultValue={profile.city} placeholder="Brooklyn" />
          <Field name="zip" label="ZIP" defaultValue={profile.zip} placeholder="11215" />
        </div>
        <Field
          name="neighborhood"
          label="Neighborhood"
          defaultValue={profile.neighborhood}
          placeholder="optional"
        />
        <Field
          name="pickup_notes"
          label="Pickup"
          defaultValue={profile.pickup_notes}
          placeholder="weekends, sidewalk, after 6…"
        />
      </div>
      {error && <p className="mt-3 text-sm text-sold">{error}</p>}
      {saved && <p className="mt-3 text-sm text-sage">Saved.</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-3 h-10 w-full rounded-full bg-ink text-xs text-paper disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input
        key={`${name}:${defaultValue}`}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-12 rounded-xl border border-line bg-paper px-3"
      />
    </label>
  );
}
