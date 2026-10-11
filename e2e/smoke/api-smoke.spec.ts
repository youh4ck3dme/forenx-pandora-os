/**
 * API smoke: jeden test pre každý route + metódu. Posiela iba NEAUTENTIFIKOVANÉ
 * a NEPLATNÉ požiadavky, ktoré musia byť odmietnuté pred akýmkoľvek zápisom.
 * V SMOKE_READONLY režime sa POST/DELETE testy preskočia a `smokeRequest`
 * by ich aj tak tvrdo odmietol.
 */
import { expect, test } from "@playwright/test";
import {
  DUMMY_UUID,
  DUMMY_UUID_2,
  READONLY,
  SAFE_METHODS,
  findLeaks,
  smokeRequest,
} from "./smoke-config";

type Case = {
  method: "GET" | "POST" | "DELETE" | "OPTIONS";
  path: string;
  /** Prijateľné statusy pre neautentifikovanú / neplatnú požiadavku. */
  expect: number[];
  data?: unknown;
  headers?: Record<string, string>;
  note: string;
  /** 429 = rate-limit (aj fail-closed limiter bez backendu) je bezpečné odmietnutie. */
  rateLimited429?: boolean;
  /** 503 je prijateľné iba ak je route zdokumentovaný ako fail-closed pri chýbajúcej konfigurácii. */
  failClosed503?: boolean;
  sse?: boolean;
  json?: boolean;
  /** Každá odpoveď (aj 2xx a 503/429) musí mať neprázdne JSON telo. */
  alwaysJson?: boolean;
};

const UNAUTH = [401];
const CASES: Case[] = [
  { method: "POST", path: "/api/audit/access/", data: {}, expect: UNAUTH, note: "audit zápis bez session" },
  { method: "POST", path: "/api/auth/session/", data: {}, expect: [400, 401], rateLimited429: true, note: "prázdny token" },
  {
    method: "POST",
    path: "/api/auth/session/",
    data: { access_token: "x" },
    headers: { origin: "https://evil.example" },
    expect: [403],
    note: "cross-origin musí byť 403",
  },
  { method: "DELETE", path: "/api/auth/session/", expect: [200, 403], note: "logout bez session (iba maže cookies)" },
  {
    method: "GET",
    path: "/api/auth/webauthn/challenge/",
    expect: [200],
    failClosed503: true, // bez WEBAUTHN_CHALLENGE_SECRET (a fallbacku) → 503 JSON
    alwaysJson: true,
    note: "verejná výzva (bez userId, bez DB zápisu)",
  },
  { method: "GET", path: "/api/auth/webauthn/register/options/", expect: UNAUTH, note: "registrácia passkey bez session" },
  { method: "POST", path: "/api/auth/webauthn/register/verify/", data: {}, expect: [400, 401], note: "prázdne telo" },
  { method: "POST", path: "/api/auth/webauthn/verify/", data: {}, expect: [400, 401], failClosed503: true, note: "prázdne telo, bez výzvy" },
  { method: "POST", path: `/api/cases/${DUMMY_UUID}/court-pack/`, data: {}, expect: UNAUTH, note: "court pack bez session" },
  {
    method: "POST",
    path: "/api/csp-report/",
    data: {},
    expect: [200, 400],
    rateLimited429: true,
    failClosed503: true, // zdieľaný limiter nedostupný → 503 (P0-09)
    alwaysJson: true,
    note: "verejný; prázdny report (nevalidný → nič sa neuloží)",
  },
  { method: "POST", path: "/api/fn/nonexistent-fn-id/", data: {}, expect: UNAUTH, note: "server fn bez session" },
  {
    method: "OPTIONS",
    path: "/api/fn/nonexistent-fn-id/",
    headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    expect: [401, 403, 204],
    note: "CORS preflight z cudzieho originu",
  },
  { method: "GET", path: "/api/forenzx/dispatch-outbox/", expect: [401], failClosed503: true, note: "cron/secret bez tajomstva" },
  { method: "POST", path: "/api/forenzx/dispatch-outbox/", data: {}, expect: [401], failClosed503: true, note: "cron/secret bez tajomstva" },
  { method: "GET", path: "/api/forenzx/jobs/", expect: UNAUTH, note: "joby bez session" },
  { method: "GET", path: `/api/forenzx/jobs/${DUMMY_UUID}/events/`, expect: UNAUTH, sse: true, note: "SSE bez session" },
  { method: "POST", path: "/api/forenzx/outbox/requeue/", data: {}, expect: UNAUTH, note: "requeue bez session" },
  { method: "POST", path: "/api/forenzx/presign-for-hub/", data: {}, expect: [401], failClosed503: true, note: "webhook secret chýba" },
  { method: "POST", path: "/api/forenzx/start/", data: {}, expect: UNAUTH, note: "štart analýzy bez session" },
  { method: "GET", path: "/api/health/observe/", expect: UNAUTH, note: "admin observability bez session" },
  { method: "POST", path: "/api/health/observe/", data: {}, expect: UNAUTH, note: "admin observability bez session" },
  { method: "GET", path: "/api/healthz/", expect: [200], json: true, note: "verejný health" },
  { method: "GET", path: `/api/vault/?caseId=${DUMMY_UUID}`, expect: UNAUTH, note: "zoznam dôkazov bez session" },
  { method: "POST", path: "/api/vault/", data: {}, expect: UNAUTH, note: "upload bez session" },
  { method: "POST", path: "/api/vault/commit/", data: { caseId: DUMMY_UUID_2 }, expect: UNAUTH, note: "commit bez session" },
  { method: "POST", path: "/api/vault/presign/", data: {}, expect: UNAUTH, note: "presign bez session" },
  { method: "GET", path: "/api/vault/verify/", expect: [401], failClosed503: true, note: "cron bez CRON_SECRET" },
  { method: "POST", path: "/api/vault/verify/", data: {}, expect: [401], failClosed503: true, note: "cron bez CRON_SECRET" },
];

// Sekvenčne (workers: 1), ale nezávisle — jeden fail nezastaví ostatné.

test.describe(`API smoke (${READONLY ? "READ-ONLY" : "full"})`, () => {
  test("read-only guard odmietne zápisovú metódu ešte pred odoslaním", async ({ request }) => {
    test.skip(!READONLY, "iba v read-only režime");
    await expect(smokeRequest(request, "POST", "/api/csp-report/", { data: {} })).rejects.toThrow(/SMOKE_READONLY/);
    await expect(smokeRequest(request, "DELETE", "/api/auth/session/")).rejects.toThrow(/SMOKE_READONLY/);
  });

  for (const c of CASES) {
    test(`${c.method} ${c.path} — ${c.note}`, async ({ request }) => {
      test.skip(READONLY && !SAFE_METHODS.has(c.method), "read-only režim: zápisové metódy sa neposielajú");
      const res = await smokeRequest(request, c.method, c.path, {
        data: c.data,
        headers: c.headers,
        timeout: c.sse ? 10_000 : undefined,
      });
      const status = res.status();
      const headers = res.headers();
      const ctype = headers["content-type"] ?? "";
      let body = "";
      if (!(c.sse && ctype.includes("text/event-stream"))) {
        body = await res.text().catch(() => "");
      }
      test.info().annotations.push({
        type: "result",
        description: `status=${status} ctype=${ctype.split(";")[0] || "-"} body=${body.slice(0, 120).replace(/\s+/g, " ")}`,
      });

      // 1. Nikdy 5xx (okrem zdokumentovaného fail-closed 503 pri chýbajúcej konfigurácii).
      const allowed = [...c.expect, ...(c.failClosed503 ? [503] : []), ...(c.rateLimited429 ? [429] : [])];
      if (!(status === 503 && c.failClosed503)) {
        expect(status, `5xx na neplatnú požiadavku; body=${body.slice(0, 300)}`).toBeLessThan(500);
      }
      expect(allowed, `status ${status} nie je v ${JSON.stringify(allowed)}`).toContain(status);
      if (status === 503) {
        test.info().annotations.push({ type: "note", description: "fail-closed 503 (route nie je nakonfigurovaný)" });
      }
      if (status === 429) {
        test.info().annotations.push({ type: "note", description: "429 rate-limit / limiter nedostupný (fail-closed)" });
      }

      // 2. Žiadne stack trace / interné cesty / tajomstvá v tele.
      expect(findLeaks(body), `únik v tele: ${body.slice(0, 300)}`).toEqual([]);

      // 3. Rozumný content-type: chybové API odpovede s telom sú JSON (nie HTML stránka).
      if (status >= 400 && body.length > 0) {
        expect(ctype, "chybová odpoveď API má byť JSON").toMatch(/application\/(problem\+)?json/);
        expect(() => JSON.parse(body)).not.toThrow();
      }
      if (c.json || c.alwaysJson) {
        expect(ctype).toMatch(/application\/json/);
      }
      if (c.alwaysJson) {
        expect(body.length, "telo nesmie byť prázdne").toBeGreaterThan(0);
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (status >= 400) expect(parsed.ok, "odmietnutie má ok:false").toBe(false);
        if (status === 503 && c.path.includes("webauthn")) {
          expect(parsed.error).toBe("WEBAUTHN_CHALLENGE_SECRET is not configured");
          expect(headers["set-cookie"] ?? "", "503 nesmie nastaviť challenge cookie").not.toContain("webauthn");
        }
        if (status === 200 && c.path.includes("csp-report")) expect(parsed).toEqual({ ok: true });
      }

      // 4. Bezpečnostné hlavičky z next.config / middleware.
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["content-security-policy"], "CSP hlavička z middleware").toBeTruthy();

      // 5. Žiadny CORS wildcard ani reflexia cudzieho originu.
      const acao = headers["access-control-allow-origin"];
      expect(acao === "*" || acao === "https://evil.example", `CORS ACAO=${acao}`).toBe(false);

      // 6. SSE: buď odmietnutie, alebo korektný event-stream.
      if (c.sse && status === 200) {
        expect(ctype).toContain("text/event-stream");
        expect(headers["cache-control"] ?? "").toMatch(/no-cache|no-store/);
      }
    });
  }
});
