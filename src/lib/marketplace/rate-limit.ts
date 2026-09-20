const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function existingContextId(error: unknown): string | null {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  const payload = (error as { error?: Record<string, unknown> }).error;
  if (status !== 409 && !/already exists/i.test(message)) return null;
  const direct = [payload?.id, payload?.contextId, payload?.existingId].find(
    (value): value is string => typeof value === "string" && UUID.test(value)
  );
  if (direct) return direct.match(UUID)?.[0] || direct;
  return `${message} ${JSON.stringify(payload || {})}`.match(UUID)?.[0] || null;
}

export function browserbaseRetryDelay(error: unknown): number | null {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  if (status !== 429 && !/429|rate limit/i.test(message)) return null;
  const seconds = message.match(/try again in (\d+)\s*seconds/i);
  if (seconds) return (Number(seconds[1]) + 2) * 1000;
  const retryAfter = (
    error as { headers?: { get?: (name: string) => string | null } }
  ).headers?.get?.("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return (Number(retryAfter) + 1) * 1000;
  return 47_000;
}

export function isRemoteMinutesError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /402|browser minutes|upgrade your account|out of minutes/i.test(message);
}
