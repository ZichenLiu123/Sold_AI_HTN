"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";

export function AuthChrome() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });
    return () => subscription.unsubscribe();
  }, [configured]);

  if (!configured || !ready) {
    return (
      <Link
        href="/platforms"
        className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-grey transition-colors hover:bg-wash hover:text-ink"
      >
        Accounts
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/platforms"
        className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-grey transition-colors hover:bg-wash hover:text-ink"
      >
        Accounts
      </Link>
      {signedIn ? (
        <SignOutButton />
      ) : (
        <Link
          href="/login"
          className="rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
      )}
    </div>
  );
}
