import { escapeLike } from "@/lib/storage/evidence-ledger";

/**
 * Register dôkazov pre AI: iba hash-overené záznamy WORM ledgera `evidence_items`
 * daného prípadu. Model smie v sourceRef/sourceReferences citovať VÝHRADNE tieto
 * ID; čokoľvek iné sa pri spracovaní výstupu zahodí.
 */
export type RegistryEntry = { evidenceId: string; fileName: string };

type LedgerQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      like: (column: string, pattern: string) => {
        eq: (column: string, value: string) => PromiseLike<{
          data: { id: string; file_name: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/** Overené dôkazy prípadu (RLS klient používateľa). Chyba → prázdny register (fail-closed). */
export async function loadEvidenceRegistry(supabase: LedgerQuery, caseId: string): Promise<RegistryEntry[]> {
  try {
    const { data, error } = await supabase
      .from("evidence_items")
      .select("id, file_name")
      .like("s3_object_key", `cases/${escapeLike(caseId)}/evidence/%`)
      .eq("hash_verification_status", "verified");
    if (error || !data) return [];
    return data.map((row) => ({ evidenceId: row.id, fileName: row.file_name }));
  } catch {
    return [];
  }
}

/** JSON bez možnosti uzavrieť XML-like blok v prompte. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Blok pre prompt autopilota (skutočné UUID). */
export function evidenceRegistryBlock(entries: readonly RegistryEntry[]): string {
  const note =
    entries.length === 0
      ? "Register je prázdny: v prípade nie je žiadny hash-overený dôkaz. Žiadne tvrdenie nesmie mať evidenceId — všetky väzby nechaj prázdne a závery označ ako NEOVERENÉ."
      : "Toto sú JEDINÉ platné evidenceId (WORM ledger, hash overený serverom). Iné ID nepoužívaj.";
  return `DÔKAZY V SPISE (register WORM ledgera):
${note}
<evidence_registry>
${safeJson(entries)}
</evidence_registry>`;
}

export type PseudonymizedRegistry = {
  /** Pre prompt: E1, E2 … namiesto UUID (bez identifikátorov úložiska). */
  entries: { id: string; fileName: string }[];
  /** E1 → UUID. */
  back: Record<string, string>;
};

export function pseudonymizeRegistry(entries: readonly RegistryEntry[]): PseudonymizedRegistry {
  const back: Record<string, string> = {};
  const out = entries.map((entry, i) => {
    const alias = `E${i + 1}`;
    back[alias] = entry.evidenceId;
    return { id: alias, fileName: entry.fileName };
  });
  return { entries: out, back };
}

type RefLike = { evidenceId?: unknown; page?: unknown; paragraph?: unknown; description?: unknown };

function remapRef(ref: RefLike, back: Record<string, string>): RefLike | null {
  const alias = typeof ref.evidenceId === "string" ? ref.evidenceId.trim() : "";
  const evidenceId = back[alias];
  return evidenceId ? { ...ref, evidenceId } : null;
}

/**
 * Preloží pseudonymy E1… vo výstupe case-úlohy späť na UUID z WORM ledgera.
 * Odkazy na neznáme ID (vymyslené, S1/T1, custody…) sa zahodia.
 */
export function remapEvidenceReferences<T extends Record<string, unknown>>(
  output: T,
  back: Record<string, string>,
): T {
  const mapList = (list: unknown): RefLike[] =>
    (Array.isArray(list) ? list : [])
      .filter((ref): ref is RefLike => typeof ref === "object" && ref !== null)
      .map((ref) => remapRef(ref, back))
      .filter((ref): ref is RefLike => ref !== null);

  const result: Record<string, unknown> = { ...output };
  if (Array.isArray(result["hypotheses"])) {
    result["hypotheses"] = (result["hypotheses"] as Record<string, unknown>[]).map((h) => ({
      ...h,
      sourceReferences: mapList(h["sourceReferences"]),
    }));
  }
  if (Array.isArray(result["defects"])) {
    result["defects"] = (result["defects"] as Record<string, unknown>[]).map((d) => {
      const alias = typeof d["sourceEvidenceId"] === "string" ? d["sourceEvidenceId"].trim() : "";
      const next: Record<string, unknown> = { ...d };
      if (back[alias]) next["sourceEvidenceId"] = back[alias];
      else delete next["sourceEvidenceId"];
      return next;
    });
  }
  if ("sourceReferences" in result) result["sourceReferences"] = mapList(result["sourceReferences"]);
  return result as T;
}
