/**
 * P1-04 — Access Audit Log (klient).
 *
 * Best-effort zápis prístupu k spisu/dôkazu do nezmeniteľného auditného
 * ledgeri cez POST /api/audit/access. Volá sa pri zobrazení alebo exporte
 * citlivého obsahu (dossier PDF, presigned URL dôkazu). Audit nikdy
 * nesmie zablokovať samotnú operáciu, preto sa chyby tlmia.
 */

export type AccessAuditAction = "view" | "export";

export async function logCaseAccess(
  caseId: string,
  action: AccessAuditAction,
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) {
    // Demo/lokálne prípady nemajú databázový záznam — nie je čo auditovať.
    return;
  }
  try {
    const token = await getSessionToken();
    await fetch("/api/audit/access", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ caseId, action }),
    });
  } catch {
    // Audit je best-effort: nikdy nepreruší export ani zobrazenie.
  }
}

/** Supabase access token aktuálnej relácie (alebo null v dev/offline režime). */
export async function getSupabaseSessionToken(): Promise<string | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function getSessionToken(): Promise<string | null> {
  return getSupabaseSessionToken();
}
