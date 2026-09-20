"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      setError("Add at least one photo.");
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
    <form onSubmit={onSubmit} className="flex min-h-[70dvh] flex-col px-4 py-4">
      <h1 className="font-serif text-4xl leading-tight">New listing.</h1>
      <p className="mt-1 text-sm text-ink/60">
        Take a few angles. The agent reads every photo.
      </p>

      <div className="mt-5">
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
        className="mt-4 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-ink/50"
      >
        {hintsOpen ? "Hide hints" : "Optional hints"}
      </button>

      {hintsOpen && (
        <div className="mt-3 grid gap-3">
          <Field name="brand" label="Brand" placeholder="if you know it" />
          <Field name="category" label="Category" placeholder="lamp, jacket…" />
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              Condition
              <select name="condition" className="h-12 rounded-xl border border-line bg-paper px-3">
                <option value="">From photo</option>
                <option>new</option>
                <option>like new</option>
                <option>good</option>
                <option>fair</option>
                <option>poor</option>
              </select>
            </label>
            <Field name="asking_price" label="Asking $" placeholder="optional" type="number" />
          </div>
          <Field name="reason_for_selling" label="Why sell" placeholder="moving, upgraded…" />
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="auto_post" className="accent-sold" />
            Auto-post when ready
          </label>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-sold">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-4 h-14 rounded-full bg-sold text-paper disabled:opacity-50"
      >
        {busy ? "Handing it to the Lister…" : "List it"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
}: {
  name: string;
  label: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        className="h-12 rounded-xl border border-line bg-paper px-3"
      />
    </label>
  );
}
