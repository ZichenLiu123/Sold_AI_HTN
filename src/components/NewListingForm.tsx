"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PhotoTray } from "./PhotoTray";

export function NewListingForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hintsOpen, setHintsOpen] = useState(false);
  const previews = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files]
  );

  useEffect(() => {
    return () => {
      for (const src of previews) URL.revokeObjectURL(src);
    };
  }, [previews]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      setError("Add at least one photo before listing.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    for (const file of files) form.append("photos", file);
    form.set("auto_post", form.get("auto_post") ? "true" : "false");
    try {
      const res = await fetch("/api/listings", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create listing");
      router.push(`/listings/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex min-h-[70dvh] flex-col px-4 py-6">
      <h1 className="display text-[1.75rem] tracking-tight">New listing</h1>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-grey">
        Photos first. Optional details help — the photo still leads.
      </p>

      <div className="mt-6">
        <PhotoTray
          photos={previews}
          onRemove={(src) => {
            const i = previews.indexOf(src);
            setFiles(files.filter((_, index) => index !== i));
          }}
          onAdd={(added) => setFiles((current) => [...current, ...added])}
        />
      </div>

      <button
        type="button"
        onClick={() => setHintsOpen((v) => !v)}
        className="mt-5 self-start text-[13px] font-medium text-grey hover:text-ink"
      >
        {hintsOpen ? "Hide optional details" : "Optional details"}
      </button>

      {hintsOpen && (
        <div className="panel mt-3 grid gap-3 p-4">
          <label className="field">
            Brand
            <input name="brand" placeholder="Brand if you know it" />
          </label>
          <label className="field">
            Category
            <input name="category" placeholder="e.g. lamp, jacket" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              Condition
              <select name="condition">
                <option value="">From photo</option>
                <option>new</option>
                <option>like new</option>
                <option>good</option>
                <option>fair</option>
                <option>poor</option>
              </select>
            </label>
            <label className="field">
              Asking $
              <input name="asking_price" type="number" placeholder="Asking price" />
            </label>
          </div>
          <label className="field">
            Why sell
            <input name="reason_for_selling" placeholder="e.g. moving, upgraded" />
          </label>
          <label className="flex items-center gap-2.5 text-[14px] font-normal text-ink">
            <input type="checkbox" name="auto_post" className="accent-ledger" />
            Auto-post when ready
          </label>
        </div>
      )}

      {error && <p className="mt-3 text-[14px] text-stamp">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
        {busy ? "Creating listing…" : "List this item"}
      </button>
    </form>
  );
}
