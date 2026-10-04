/**
 * P1-04 / Vault hardening — serverová autentifikácia, kontrola vlastníctva
 * spisu a priamy zápis prístupového auditu pre všetky vault routes.
 *
 * GET /api/vault (list + presign na stiahnutie) aj POST /api/vault/presign
 * (upload) overia identitu vyšetrovateľa, v produkcii skontrolujú vlastníctvo
 * spisu a nezmeniteľne zaznamenajú prístup cez public.log_case_access.
 * Audit je fail-closed: ak sa záznam nepodarí zapísať, prístup sa odmietne.
 */
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTrustedClientIp } from "@/lib/security/client-ip";

/** Právny základ prístupu vyšetrovateľa k spisu (§ 119 TP / GDPR). */
export const VAULT_LEGAL_BASIS =
  "§ 119 ods. 2 Trestného poriadku; GDPR čl. 6(1)(e), čl. 9(2)(f)";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidCaseId(value: string): boolean {
  return UUID_RE.test(value);
}

export type VaultAuth =
  /**
   * `devBypass: true` = identita z lokálneho vývojárskeho obchvatu, nie z tokenu.
   * Iba vtedy smú routes preskočiť kontrolu vlastníctva a audit.
   */
  | { userId: string; token: string | null; devBypass: boolean }
  | { userId: null; token: null; error: string; status: number };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Požiadavka smeruje na loopback a neprešla cez proxy zo vzdialenej adresy.
 * Pozor: `Host` aj `x-forwarded-for` vie klient podvrhnúť (Next nastaví XFF
 * zo socketu len keď chýba) a adresa socketu v route handleri nie je
 * dostupná — preto je to iba doplnková kontrola. Skutočnú ochranu dáva
 * `devAuthBypassAllowed`: obchvat v `next dev` funguje len bez reálnych dát.
 */
function isLoopbackRequest(request: NextRequest): boolean {
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(hostname)) return false;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(":")[0];
  if (forwardedHost && !LOOPBACK_HOSTS.has(forwardedHost)) return false;
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map((hop) => hop.trim());
    if (!hops.every((hop) => LOOPBACK_IPS.has(hop))) return false;
  }
  return true;
}

/** Proces má prístup k reálnym dôkazom (S3 trezor alebo service rola Supabase). */
function hasRealEvidenceAccess(): boolean {
  return Boolean(
    process.env.S3_ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.S3_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * P0-08 (N-03): vývojársky obchvat autentifikácie je povolený iba:
 * - v unit testoch (`NODE_ENV=test`), alebo
 * - pri `next dev` s výslovným `ALLOW_DEV_AUTH_BYPASS=true`, mimo Vercelu, na
 *   loopback požiadavku a **bez prístupu k reálnym dôkazom** (bez S3 kľúčov a
 *   bez service role). Loopback sa v route nedá spoľahlivo overiť (hlavičky sú
 *   podvrhnuteľné), preto podvrhnutý obchvat nesmie mať čo získať: s reálnym
 *   úložiskom je povinné skutočné prihlásenie.
 * Samotné `NODE_ENV !== "production"` (staging, preview) už nestačí.
 */
export function devAuthBypassAllowed(request: NextRequest): boolean {
  const env = process.env.NODE_ENV;
  if (env === "production") return false;
  if (env === "test") return true;
  if (process.env.ALLOW_DEV_AUTH_BYPASS !== "true") return false;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  if (hasRealEvidenceAccess()) return false;
  return isLoopbackRequest(request);
}

/**
 * Overí vyšetrovateľa podľa Authorization: Bearer <supabase JWT>.
 * Bez platného tokenu je jediná výnimka lokálny obchvat (`devAuthBypassAllowed`).
 */
export async function authenticateVaultRequest(
  request: NextRequest,
): Promise<VaultAuth> {
  const bypass = devAuthBypassAllowed(request);
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "").trim()
    : null;

  if (token && token.split(".").length === 3) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY;
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await supabase.auth.getUser(token);
        if (data?.user) return { userId: data.user.id, token, devBypass: false };
        if (error && !bypass) {
          return {
            userId: null,
            token: null,
            error: `Neplatný auth token: ${error.message}`,
            status: 401,
          };
        }
      } catch {
        // Prechodná chyba overenia — v produkcii pokračujeme na odmietnutie.
      }
    }
  }

  if (bypass) {
    // Voľbu identity hlavičkou majú len unit testy; v `next dev` je identita
    // obchvatu pevná, takže sa nedá vydávať za konkrétneho vyšetrovateľa.
    const devUserId =
      (process.env.NODE_ENV === "test" &&
        (request.headers.get("x-dev-user-id") || request.headers.get("x-user-id"))) ||
      "dev-investigator-001";
    return { userId: devUserId, token, devBypass: true };
  }

  return {
    userId: null,
    token: null,
    error:
      "Neautorizovaný prístup: Chýba platná autorizačná relácia vyšetrovateľa.",
    status: 401,
  };
}

export type OwnershipResult = "ok" | "not_found" | "forbidden" | "unavailable";

/** Kontrola vlastníctva spisu cez service rolu (IDOR ochrana). */
export async function verifyCaseOwnership(
  caseId: string,
  userId: string,
): Promise<OwnershipResult> {
  if (!isUuidCaseId(caseId)) {
    return "not_found";
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("cases")
      .select("id, user_id")
      .eq("id", caseId)
      .maybeSingle();
    if (error) {
      if (error.code === "22P02") return "not_found";
      return "unavailable";
    }
    if (!data) return "not_found";
    return data.user_id === userId ? "ok" : "forbidden";
  } catch {
    return "unavailable";
  }
}

export type VaultAccessAction = "view" | "export" | "upload";

/** Zapíše prístup do nezmeniteľného auditného ledgeri (log_case_access). */
export async function logVaultAccess(params: {
  token: string;
  caseId: string;
  action: VaultAccessAction;
  sourceIp: string;
  userAgent: string;
}): Promise<boolean> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return false;
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${params.token}` } },
    });
    const { error } = await supabase.rpc("log_case_access", {
      _case_id: params.caseId,
      _action: params.action,
      _legal_basis: VAULT_LEGAL_BASIS,
      _source_ip: params.sourceIp,
      _user_agent: params.userAgent,
    });
    return !error;
  } catch {
    return false;
  }
}

/** Vyťaží caseId zo storage kľúča vo formáte cases/<caseId>/… */
export function caseIdFromStorageKey(storageKey: string): string | null {
  const match = /^cases\/([0-9a-f-]{36})\//i.exec(storageKey);
  return match?.[1] ?? null;
}

/** Source IP a User Agent z hlavičiek požiadavky. */
export function accessContext(request: NextRequest): {
  sourceIp: string;
  userAgent: string;
} {
  return {
    sourceIp: getTrustedClientIp(request, ""),
    userAgent: request.headers.get("user-agent") || "",
  };
}
