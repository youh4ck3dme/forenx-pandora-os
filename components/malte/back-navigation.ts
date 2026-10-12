/**
 * Deterministická logika tlačidla „Späť“.
 *
 * Poradie:
 *   1. explicitný `backHref` z danej obrazovky,
 *   2. známy nadradený route (PARENT_ROUTE),
 *   3. `history.back()` iba vtedy, keď predchádzajúca stránka je z rovnakého
 *      originu (inak by „Späť“ mohlo opustiť aplikáciu alebo skončiť na
 *      externej stránke),
 *   4. bezpečný interný fallback `/forza/prehlad`.
 */

export const BACK_FALLBACK_ROUTE = "/forza/prehlad";

/** Nadradené route pre obrazovky s tlačidlom „Späť“ (bez trailing slash). */
export const PARENT_ROUTE: Readonly<Record<string, string>> = {
  "/forza/zbrane": "/forza/viac",
  "/forza/pravny-kontext": "/forza/viac",
  "/forza/mcp-info": "/forza/viac",
  "/forza/profil": "/forza/viac",
};

export type BackTarget =
  | { kind: "href"; href: string; source: "explicit" | "parent" | "fallback" }
  | { kind: "history" };

/** Povolený je iba interný relatívny path (nie `//host`, nie schéma). */
export function isSafeInternalPath(value: string | null | undefined): value is string {
  if (!value || typeof value !== "string") return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  return true;
}

export function normalizePathname(pathname: string | null | undefined): string {
  if (!pathname) return "/";
  const clean = pathname.split(/[?#]/)[0] ?? "/";
  return clean.length > 1 ? clean.replace(/\/+$/, "") || "/" : clean;
}

/** Statický cieľ, ktorý je známy už pri renderi (explicit/parent). */
export function resolveStaticBackHref(input: {
  pathname: string | null | undefined;
  backHref?: string | null;
}): { href: string; source: "explicit" | "parent" } | null {
  if (isSafeInternalPath(input.backHref)) {
    return { href: input.backHref, source: "explicit" };
  }
  const parent = PARENT_ROUTE[normalizePathname(input.pathname)];
  return parent ? { href: parent, source: "parent" } : null;
}

export function hasSameOriginHistory(input: {
  referrer: string | null | undefined;
  origin: string | null | undefined;
  historyLength: number;
}): boolean {
  if (!input.referrer || !input.origin || input.historyLength <= 1) return false;
  try {
    return new URL(input.referrer).origin === input.origin;
  } catch {
    return false;
  }
}

export function resolveBackTarget(input: {
  pathname: string | null | undefined;
  backHref?: string | null;
  referrer?: string | null;
  origin?: string | null;
  historyLength?: number;
}): BackTarget {
  const known = resolveStaticBackHref(input);
  if (known) return { kind: "href", ...known };
  if (
    hasSameOriginHistory({
      referrer: input.referrer,
      origin: input.origin,
      historyLength: input.historyLength ?? 0,
    })
  ) {
    return { kind: "history" };
  }
  return { kind: "href", href: BACK_FALLBACK_ROUTE, source: "fallback" };
}
