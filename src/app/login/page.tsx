"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SoldMark } from "@/components/SoldMark";


function friendlyAuthError(reason: unknown, kind: "signin" | "signup" | "magic") {
  const raw = reason instanceof Error ? reason.message : "";
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "Wrong email or password.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email, then try again.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "That email already has an account — sign in instead.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (raw) return raw;
  if (kind === "magic") return "Could not send magic link.";
  if (kind === "signup") return "Could not create account.";
  return "Could not sign in.";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/listings";
  const configured = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ),
    []
  );

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"signin" | "signup" | "magic" | false>(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!configured) return;
    setBusy(mode);
    setError("");
    setMessage("");
    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { error: signError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (signError) throw signError;
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          router.replace(next);
          router.refresh();
          return;
        }
        setMessage(
          "Account created. If email confirmation is on, check your inbox — otherwise sign in."
        );
      } else {
        const { error: signError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signError) throw signError;
        router.replace(next);
        router.refresh();
      }
    } catch (reason) {
      setError(friendlyAuthError(reason, mode === "signup" ? "signup" : "signin"));
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    if (!configured) return;
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setBusy("magic");
    setError("");
    setMessage("");
    const supabase = createClient();
    try {
      const { error: linkError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (linkError) throw linkError;
      setMessage("Magic link sent — open it on this device to continue.");
    } catch (reason) {
      setError(friendlyAuthError(reason, "magic"));
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
        <SoldMark large />
        <h1 className="mt-8 display text-[1.75rem] tracking-tight">Sign in</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-grey">
          Auth isn&apos;t configured in this environment. Add{" "}
          <code className="text-[13px] text-ink">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-[13px] text-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          to <code className="text-[13px] text-ink">.env.local</code>, then restart
          the app.
        </p>
        <Link href="/listings" className="btn-primary mt-8 w-full text-center">
          Continue without an account
        </Link>
        <Link
          href="/"
          className="mt-6 text-center text-[13px] font-medium text-grey hover:text-ink"
        >
          ← Back to Sold
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
      <SoldMark large />
      <h1 className="mt-8 display text-[1.75rem] tracking-tight">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-grey">
        Your listings, marketplace sessions, and inbox stay behind your account.
      </p>

      <form onSubmit={onSubmit} className="mt-8 grid gap-3">
        <label className="field">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="at least 8 characters"
          />
        </label>

        {error ? (
          <p className="rounded-xl border border-line bg-wash px-3.5 py-2.5 text-[13px] text-stamp">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-xl border border-line bg-wash px-3.5 py-2.5 text-[13px] text-ink">
            {message}
          </p>
        ) : null}

        <button type="submit" disabled={Boolean(busy)} className="btn-primary mt-1 w-full">
          {busy === "signin"
            ? "Signing in…"
            : busy === "signup"
              ? "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
        </button>
      </form>

      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() => void sendMagicLink()}
        className="btn-secondary mt-3 w-full"
      >
        {busy === "magic" ? "Sending link…" : "Email me a magic link"}
      </button>

      <p className="mt-6 text-center text-[13px] text-grey">
        {mode === "signin" ? (
          <>
            New here?{" "}
            <button
              type="button"
              className="font-semibold text-ink underline-offset-2 hover:underline"
              onClick={() => {
                setMode("signup");
                setError("");
                setMessage("");
              }}
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              className="font-semibold text-ink underline-offset-2 hover:underline"
              onClick={() => {
                setMode("signin");
                setError("");
                setMessage("");
              }}
            >
              Sign in
            </button>
          </>
        )}
      </p>

      <Link
        href="/"
        className="mt-8 text-center text-[13px] font-medium text-grey hover:text-ink"
      >
        ← Back to Sold
      </Link>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center px-4 py-10 text-[14px] text-grey">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
