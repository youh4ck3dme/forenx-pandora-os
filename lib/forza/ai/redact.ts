import type { CaseAnalysis, Flag } from "@/forensic";

/**
 * Minimalizácia a pseudonymizácia dát pred odoslaním do Mistralu.
 *
 * Identifikátory subjektov a transakcií sa nahrádzajú konzistentnými pseudonymami
 * (S1, S2, T1 …), takže väzby medzi záznamami ostávajú zachované, ale mená,
 * adresy, IČO ani UUID sa neodosielajú.
 *
 * Automatická redakcia NIE JE záruka: voľný text (popis platby, poznámka) môže
 * obsahovať mená, čísla účtov alebo iné citlivé údaje. Preto sa používateľovi
 * pred odoslaním zobrazuje presný náhľad odosielaných dát.
 */

export const PROMPT_VERSION = "2026.09.2";

const PII_PATTERNS: readonly [RegExp, string][] = [
  [/\b[A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/gi, "[REDACTED_IBAN]"],
  [/\b\d{6}\s*(?:\/|\|)\s*\d{3,4}\b/g, "[REDACTED_NATIONAL_ID]"],
  [
    /\b(?:rodn[ée]?\s*č[íi]slo|r[čc]|id(?:entifikačn[ée]?\s*č[íi]slo)?)\s*[:#]?\s*\d[\d\s/-]{6,18}\b/gi,
    "[REDACTED_ID]",
  ],
  [
    /\b(?:ul(?:ica)?\.?|n[áa]m(?:estie)?\.?|trieda|cesta)\s+[A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ][\p{L}' -]{1,60}\s+\d{1,4}[A-Za-z]?(?:\/\d{1,4})?\b/giu,
    "[REDACTED_ADDRESS]",
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
  [/\b(?:\+?\d{1,3}[\s-]?)?(?:\d{3}[\s-]?){2,4}\d{2,4}\b/g, "[REDACTED_PHONE]"],
];

/** Redacts common PII before evidence-derived free text reaches an AI provider. */
export function redactEvidenceText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of PII_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/** Serializes untrusted case data without permitting it to terminate XML-like prompt delimiters. */
export function serializeUntrustedAiPayload(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/** Outcome claims require a documentary citation; unsupported text is not displayable. */
export function isClearanceOrInnocenceClaim(value: string): boolean {
  return /\b(?:nevinn\w*|oslobod\w*|zbaven\w*|not\s+guilty|innocen\w*|clear(?:ed|ance)?)\b/iu.test(
    value,
  );
}

export type Pseudonyms = {
  entity: Record<string, string>;
  entityBack: Record<string, string>;
  transaction: Record<string, string>;
  transactionBack: Record<string, string>;
};

export type AiPayload = {
  case: {
    pseudonym: string;
    baseCurrency: string;
    referenceDate: string;
    revision: string;
  };
  entities: { id: string; kind: string; role: string; country: string }[];
  transactions: {
    id: string;
    date: string;
    amount: number;
    currency: string;
    method: string;
    from: string;
    to: string;
    description: string;
  }[];
  findings: {
    ruleId: string;
    kind: string;
    condition: string;
    severity: string;
    evidence: string[];
  }[];
};

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function buildPseudonyms(analysis: CaseAnalysis): Pseudonyms {
  const entity: Record<string, string> = {};
  const entityBack: Record<string, string> = {};
  const transaction: Record<string, string> = {};
  const transactionBack: Record<string, string> = {};
  analysis.case.entities.forEach((e, i) => {
    const alias = `S${i + 1}`;
    entity[e.id] = alias;
    entityBack[alias] = e.id;
  });
  analysis.case.transactions.forEach((t, i) => {
    const alias = `T${i + 1}`;
    transaction[t.id] = alias;
    transactionBack[alias] = t.id;
  });
  return { entity, entityBack, transaction, transactionBack };
}

export type PayloadScope =
  | { task: "explain_finding"; alertId: string }
  | { task: "case_summary" }
  | { task: "normalize_descriptions" }
  | { task: "alt_devil" }
  | { task: "admiss_audit" };

function flagsOfAlert(analysis: CaseAnalysis, alertId: string): Flag[] {
  const alert = analysis.alerts.find((a) => a.id === alertId);
  if (!alert) return [];
  const all: Flag[] = [
    ...analysis.entities.flatMap((e) => e.flags),
    ...analysis.transactions.flatMap((t) => t.flags),
    ...analysis.weapons.flatMap((w) => w.flags),
  ];
  return all.filter(
    (f) => alert.id.includes(f.code) || alert.title === f.label,
  );
}

/** Zostaví minimalizovaný a pseudonymizovaný obsah pre konkrétnu úlohu. */
export function buildAiPayload(
  analysis: CaseAnalysis,
  scope: PayloadScope,
  pseudonyms: Pseudonyms = buildPseudonyms(analysis),
): { payload: AiPayload; pseudonyms: Pseudonyms } {
  const alias = (id: string) => pseudonyms.entity[id] ?? "S?";
  const txAlias = (id: string) => pseudonyms.transaction[id] ?? "T?";

  const flags =
    scope.task === "explain_finding"
      ? flagsOfAlert(analysis, scope.alertId)
      : [];
  const evidenceIds = new Set(
    flags.flatMap((f) => (f.evidence ?? []).map((e) => e.id)),
  );

  const includeTx =
    scope.task === "case_summary" || scope.task === "normalize_descriptions"
      ? analysis.case.transactions
      : analysis.case.transactions.filter((t) => evidenceIds.has(t.id));

  const includeEntities =
    scope.task === "explain_finding"
      ? analysis.case.entities.filter(
          (e) =>
            evidenceIds.has(e.id) ||
            includeTx.some((t) => t.fromId === e.id || t.toId === e.id),
        )
      : analysis.case.entities;

  const payload: AiPayload = {
    case: {
      pseudonym: "PRÍPAD",
      baseCurrency: analysis.case.baseCurrency,
      referenceDate: analysis.case.referenceDate,
      revision: analysis.dataFingerprint ?? "",
    },
    entities: includeEntities.map((e) => ({
      id: alias(e.id),
      kind: e.kind,
      role: truncate(redactEvidenceText(e.role), 60),
      country: e.country,
    })),
    transactions: includeTx.map((t) => ({
      id: txAlias(t.id),
      date: t.date,
      amount: t.amount,
      currency: t.currency,
      method: t.method,
      from: alias(t.fromId),
      to: alias(t.toId),
      description: truncate(redactEvidenceText(t.description), 160),
    })),
    findings: (scope.task === "explain_finding"
      ? flags
      : analysis.alerts
          .slice(0, 30)
          .flatMap((a) => flagsOfAlert(analysis, a.id))
    ).map((f) => ({
      ruleId: f.ruleId ?? f.code,
      kind: f.kind ?? "heuristika",
      condition: redactEvidenceText(f.condition ?? ""),
      severity: f.severity,
      evidence: (f.evidence ?? []).map((e) =>
        e.type === "transaction" ? txAlias(e.id) : alias(e.id),
      ),
    })),
  };

  return { payload, pseudonyms };
}

/** Čitateľný náhľad toho, čo presne odchádza poskytovateľovi. */
export function payloadPreview(payload: AiPayload): string {
  return JSON.stringify(payload, null, 2);
}
