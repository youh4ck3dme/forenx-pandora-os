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

/** Právny základ prístupu vyšetrovateľa k spisu (§ 119 TP / GDPR). */
export const VAULT_LEGAL_BASIS =
  "§ 119 ods. 2 Trestného poriadku; GDPR čl. 6(1)(e), čl. 9(2)(f)";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidCaseId(value: string): boolean {
  return UUID_RE.test(value);
}

export type VaultAuth =
  | { userId: string; token: string | null }
  | { userId: null; token: null; error: string; status: number };

/**
 * Overí vyšetrovateľa podľa Authorization: Bearer <supabase JWT>.
 * V dev režime (a testoch) beží bypass cez x-dev-user-id, v produkcii je
 * platný token povinný.
 */
export async function authenticateVaultRequest(
  request: NextRequest,
): Promise<VaultAuth> {
  const isDev = process.env.NODE_ENV !== "production";
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
        if (data?.user) return { userId: data.user.id, token };
        if (error && !isDev) {
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

  if (isDev) {
    const devUserId =
      request.headers.get("x-dev-user-id") ||
      request.headers.get("x-user-id") ||
      "dev-investigator-001";
    return { userId: devUserId, token };
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
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("cases")
      .select("id, user_id")
      .eq("id", caseId)
      .maybeSingle();
    if (error) return "unavailable";
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
    sourceIp:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "",
    userAgent: request.headers.get("user-agent") || "",
  };
}
