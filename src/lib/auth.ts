import { authConfigured } from "@/lib/auth-config";
export { authConfigured } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";
import { DEMO_USER } from "@/lib/types";

export type AuthUser = {
  id: string;
  email: string | null;
};

/** Current signed-in user, or null. */
export async function getAuthUser(): Promise<AuthUser | null> {
  if (!authConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

/**
 * Require a signed-in user for API/app work.
 * Falls back to DEMO_USER only when Supabase env is not configured (local demo).
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (user) return user;
  if (!authConfigured()) {
    return { id: DEMO_USER.id, email: null };
  }
  throw new AuthRequiredError();
}

export class AuthRequiredError extends Error {
  status = 401;
  constructor() {
    super("Sign in required.");
    this.name = "AuthRequiredError";
  }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  return null;
}
