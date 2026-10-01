/**
 * Schéma odpovede forenzného autopilota.
 * Chráni pred halucináciou, ktorá je síce platný JSON, ale nemá správnu štruktúru.
 *
 * P4: Sub-schémy pre timeline, traces, útoky, dôkazy a paragrafy sú striktne
 * typované (nie voľné `record(unknown)`), aby sa zachytili halucinácie so
 * správnou štruktúrou, ale nesprávnymi hodnotami.
 */
import { z } from "zod";
import { repairTruncatedJson, stripCodeFences } from "@/lib/ai/parse-json";

export { repairTruncatedJson, stripCodeFences };

// ─── Schémy pre doménové sub-typy (zodpovedajú types.ts) ────────────

/** TrafficLight: identické s TypeScript typom v types.ts. */
const trafficLight = z.enum(["green", "yellow", "red"]);

/**
 * SourceRef — štruktúrovaný odkaz na zdroj.
 * Voľné polia ostávajú povolené cez passthrough(), aby sme boli spätne kompatibilní.
 */
const sourceRefSchema = z
  .object({
    documentId: z.string(),
    evidenceId: z.string().optional(),
    page: z.number().optional(),
    paragraph: z.string().optional(),
    excerpt: z.string().optional(),
    label: z.string().optional(),
  })
  .passthrough();

/** TimelineEvent — zodpovedá interface TimelineEvent v types.ts. */
const timelineEventSchema = z
  .object({
    time: z.string(),
    event: z.string(),
    source: z.string(),
    sourceRef: sourceRefSchema.optional(),
    chainBreak: z.boolean(),
    severity: z.enum(["critical", "warning", "info"]).optional(),
    paragraph: z.string().optional(),
  })
  .passthrough();

/** TraceItem — zodpovedá interface TraceItem v types.ts. */
const traceItemSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    description: z.string(),
    light: trafficLight,
    chainComplete: z.boolean(),
    lr: z.string().optional(),
    paragraph: z.string().optional(),
    sourceRef: sourceRefSchema.optional(),
  })
  .passthrough();

/** DefenseAttack — zodpovedá interface DefenseAttack v types.ts. */
const defenseAttackSchema = z
  .object({
    id: z.string(),
    defenseClaim: z.string(),
    risk: z.enum(["KRITICKÉ", "VYSOKÉ", "STREDNÉ", "NÍZKE"]),
    counterStrike: z.string(),
    evidenceGap: z.string(),
    paragraph: z.string().optional(),
    sourceRef: sourceRefSchema.optional(),
  })
  .passthrough();

/** EvidenceRow — zodpovedá interface EvidenceRow v types.ts. */
const evidenceRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lr: z.string(),
    strength: z.enum(["Nepriestrelné", "Silná", "Zraniteľné", "Procesná mína"]),
    light: trafficLight,
    paragraph: z.string(),
    sourceRef: sourceRefSchema.optional(),
  })
  .passthrough();

/** ParagraphStatus — zodpovedá interface ParagraphStatus v types.ts. */
const paragraphStatusSchema = z
  .object({
    para: z.string(),
    title: z.string(),
    status: z.enum(["OK", "Narušené", "Príprava"]),
    note: z.string(),
    sourceRef: sourceRefSchema.optional(),
  })
  .passthrough();

/** AutopilotAnalysisMeta — striktná sub-schéma (P4: klient nesmie injektovať meta). */
export const analysisMeta = z
  .object({
    promptVersion: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    provider: z.string().max(80).optional(),
    createdAt: z.string().datetime({ offset: true }),
    analysisStatus: z.enum(["complete", "partial", "failed", "demo"]),
    documentIds: z.array(z.string()),
    sourceReferences: z.array(z.string()),
    idempotencyKey: z.string().min(1).max(300),
    truncation: z.object({
      inputChars: z.number().int().nonnegative(),
      analyzedChars: z.number().int().nonnegative(),
      truncated: z.boolean(),
      chunkCount: z.number().int().positive(),
      chunkLimit: z.number().int().positive(),
      documentLimit: z.number().int().positive(),
    }),
    chunks: z.array(
      z.object({
        index: z.number().int().positive(),
        total: z.number().int().positive(),
        charCount: z.number().int().nonnegative(),
        status: z.enum(["ok", "failed", "repaired"]),
        error: z.string().optional(),
      }),
    ),
    isDemo: z.boolean().optional(),
    heuristicModulesNote: z.string().optional(),
  })
  .passthrough();

export const forensicDossierSchema = z
  .object({
    caseId: z.string().optional(),
    caseTitle: z.string().optional(),
    defendabilityIndex: z.number().optional(),
    generatedAt: z.string().optional(),
    analysisMeta: analysisMeta.optional(),
    facts: z
      .object({
        // P4: typed schema namiesto z.record(z.unknown())
        timeline: z.array(timelineEventSchema),
        traces: z.array(traceItemSchema).optional(),
      })
      .passthrough(),
    defenseAttack: z
      .object({
        overallRisk: z.string().optional(),
        // P4: typed schema namiesto z.record(z.unknown())
        attacks: z.array(defenseAttackSchema).optional(),
      })
      .passthrough(),
    evidenceStrength: z
      .object({
        // P4: typed schema namiesto z.record(z.unknown())
        traces: z.array(evidenceRowSchema).optional(),
        paragraphs: z.array(paragraphStatusSchema).optional(),
      })
      .passthrough(),
    judgeReadyText: z.union([z.string(), z.record(z.unknown())]),
  })
  .passthrough();

export type ParsedForensicDossier = z.infer<typeof forensicDossierSchema>;

export const DOSSIER_SCHEMA_ERROR =
  "AI nevrátila kompletnú forenznú štruktúru (fakty, obhajoba, sila dôkazov). Skúste analýzu spustiť znova.";

/**
 * Výsledok parsovania dossiera.
 * P4: `wasRepaired` musí byť viditeľný pre volajúceho — opravený JSON
 * sa označuje ako `status: "repaired"`, nie ako úspech bez varovania.
 */
export type ParseForensicDossierResult = {
  data: ParsedForensicDossier;
  /** true = JSON bol useknutý alebo poškodený a bol automaticky opravený. */
  wasRepaired: boolean;
};

/**
 * Rozparsuje a overí odpoveď AI.
 * Vyhodí chybu so slovenskou hláškou.
 *
 * P4: Vracia `{ data, wasRepaired }`. Volajúci musí nastaviť stav chunka
 * na `"repaired"` ak `wasRepaired === true` — opravený JSON nesmie byť
 * prezentovaný ako kompletný úspešný výsledok.
 */
export function parseForensicDossier(
  content: string,
): ParseForensicDossierResult {
  const cleaned = stripCodeFences(content);
  const start = cleaned.indexOf("{");
  const candidate = start > 0 ? cleaned.slice(start) : cleaned;

  let raw: unknown;
  const tryParse = (text: string): boolean => {
    try {
      raw = JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  };

  let wasRepaired = false;
  if (!tryParse(candidate)) {
    const repaired = repairTruncatedJson(candidate);
    if (!repaired || !tryParse(repaired)) {
      throw new Error("Odpoveď AI nebola platným JSON.");
    }
    wasRepaired = true;
  }

  // Po oprave useknutej odpovede môžu chýbať celé sekcie – doplníme prázdne.
  // Opravený JSON je označený ako čiastočný (wasRepaired = true); volajúci
  // musí nastaviť status chunka na "repaired", nie "ok".
  if (wasRepaired && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const facts = (obj["facts"] ?? {}) as Record<string, unknown>;
    if (!Array.isArray(facts["timeline"])) facts["timeline"] = [];
    obj["facts"] = facts;
    if (
      typeof obj["defenseAttack"] !== "object" ||
      obj["defenseAttack"] === null
    )
      obj["defenseAttack"] = {};
    if (
      typeof obj["evidenceStrength"] !== "object" ||
      obj["evidenceStrength"] === null
    )
      obj["evidenceStrength"] = {};
    if (obj["judgeReadyText"] === undefined) obj["judgeReadyText"] = "";
  }

  // P4: Schéma je striktná — nevyhovujúce položky sú odfiltrované (passthrough)
  // len pre neznáme extra polia, nie pre nesprávne typy povinných polí.
  const result = forensicDossierSchema.safeParse(raw);
  if (!result.success) throw new Error(DOSSIER_SCHEMA_ERROR);
  return { data: result.data, wasRepaired };
}

