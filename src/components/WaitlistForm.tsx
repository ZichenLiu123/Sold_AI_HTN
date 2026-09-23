"use client";

import { useState } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setDone(true);
  }

  if (done) {
    return (
      <p className="text-[14px] text-ink">
        Got it. We&apos;ll email {email.trim()} when paid seats open.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md gap-2">
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
      />
      <button type="submit" className="btn-primary h-11 shrink-0">
        Join the waitlist
      </button>
    </form>
  );
}
