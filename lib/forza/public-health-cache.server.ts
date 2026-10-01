import type { PublicHealthResponse } from "./public-health";

export const PUBLIC_HEALTH_CACHE_TTL_MS = 15_000;

let cachedHealth: {
  expiresAt: number;
  response: PublicHealthResponse;
} | null = null;

export function getCachedPublicHealth(
  now = Date.now(),
): PublicHealthResponse | null {
  if (!cachedHealth || cachedHealth.expiresAt <= now) return null;
  return cachedHealth.response;
}

export function cachePublicHealth(
  response: PublicHealthResponse,
  now = Date.now(),
): void {
  cachedHealth = {
    expiresAt: now + PUBLIC_HEALTH_CACHE_TTL_MS,
    response,
  };
}

/** Test-only reset; the route itself exports only supported Next handlers. */
export function resetPublicHealthCacheForTests(): void {
  cachedHealth = null;
}
