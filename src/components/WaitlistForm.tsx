"use client";

import { useState } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not join the waitlist.");
      }
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not join.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-[14px] leading-relaxed text-ink">
        You&apos;re on the list. We&apos;ll email{" "}
        <span className="font-medium">{email.trim()}</span> when paid seats open.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-2">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="waitlist-email">
          Email
        </label>
        <input
          id="waitlist-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="input h-11 flex-1"
          disabled={busy}
        />
        <button type="submit" className="btn-primary h-11 shrink-0" disabled={busy}>
          {busy ? "Saving…" : "Join waitlist"}
        </button>
      </div>
      {error ? (
        <p className="text-[13px] text-stamp">{error}</p>
      ) : null}
    </form>
  );
}
