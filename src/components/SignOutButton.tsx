"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void signOut()}
      className={
        className ||
        "rounded-full px-3 py-1.5 text-[13px] font-semibold text-grey transition-colors hover:bg-wash hover:text-ink"
      }
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}
