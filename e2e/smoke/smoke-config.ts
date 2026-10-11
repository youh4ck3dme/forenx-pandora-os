/**
 * Spoločná konfigurácia smoke testov (API + stránky).
 *
 * SMOKE_READONLY=1 je TVRDO vynútený: `smokeRequest` odmietne poslať čokoľvek
 * iné ako GET/HEAD/OPTIONS (vyhodí chybu ešte pred odoslaním) a stránkové testy
 * v prehliadači abortujú každú nie-GET požiadavku (napr. automatické CSP
 * reporty alebo telemetriu), takže proti produkcii nemôže odísť žiadny zápis.
 */
import type { APIRequestContext, APIResponse } from "@playwright/test";

export const BASE_URL = (
  process.env.BASE_URL ??
  process.env.E2E_BASE_URL ??
  "http://localhost:3007"
).replace(/\/+$/, "");

const PROD_HOSTS = ["pandora.whoiswho.at"];

/** Read-only režim: explicitne cez SMOKE_READONLY=1 alebo automaticky pre produkčný host. */
export const READONLY =
  process.env.SMOKE_READONLY === "1" ||
  PROD_HOSTS.some((host) => new URL(BASE_URL).hostname === host);

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Pauza medzi požiadavkami (nízka záťaž na produkcii). */
export const REQUEST_DELAY_MS = Number(process.env.SMOKE_DELAY_MS ?? (READONLY ? 750 : 0));

export const DUMMY_UUID = "00000000-0000-4000-8000-000000000000";
export const DUMMY_UUID_2 = "11111111-1111-4111-8111-111111111111";

export class ReadOnlyViolation extends Error {
  constructor(method: string, path: string) {
    super(`SMOKE_READONLY: ${method} ${path} je zakázaný (povolené iba GET/HEAD/OPTIONS).`);
    this.name = "ReadOnlyViolation";
  }
}

export function assertMethodAllowed(method: string, path: string): void {
  if (READONLY && !SAFE_METHODS.has(method.toUpperCase())) {
    throw new ReadOnlyViolation(method.toUpperCase(), path);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function smokeRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { data?: unknown; headers?: Record<string, string>; timeout?: number } = {},
): Promise<APIResponse> {
  const upper = method.toUpperCase();
  assertMethodAllowed(upper, path);
  if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
  return request.fetch(path, {
    method: upper,
    headers: options.headers,
    data: options.data,
    maxRedirects: 0,
    failOnStatusCode: false,
    timeout: options.timeout ?? 20_000,
  });
}

/** Vzory, ktoré nesmú byť v tele chybovej odpovede (stack trace, interné cesty, tajomstvá). */
export const LEAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "stack frame", re: /\n\s+at\s+[^\n]*\(?[^\s()]+:\d+:\d+\)?/ },
  { name: "node_modules path", re: /node_modules[\\/]/ },
  { name: "absolute server path", re: /(?:[A-Z]:\\(?:Users|Projects)|\/(?:home|var\/www|app)\/[\w.-]+\/)/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./ },
  { name: "service role", re: /service_role|SUPABASE_SERVICE_ROLE_KEY|S3_SECRET_ACCESS_KEY|CRON_SECRET=|FORENZX_WEBHOOK_SECRET=/ },
  { name: "postgres error detail", re: /\b(?:PGRST\d+|relation "[^"]+" does not exist|duplicate key value)\b/ },
];

export function findLeaks(body: string): string[] {
  return LEAK_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.name);
}
