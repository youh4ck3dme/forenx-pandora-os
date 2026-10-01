import { z } from "zod";

export type PublicHealthStatus = "ok" | "attention" | "unavailable";

export type PublicHealthCheck = {
  id: string;
  title: string;
  description: string;
  value: string;
  status: PublicHealthStatus;
  measurement: "live" | "capability";
  measuredAt?: string;
};

export type PublicHealthResponse = {
  checkedAt: string;
  overallStatus: PublicHealthStatus;
  checks: PublicHealthCheck[];
};

export const PublicHealthResponseSchema = z.object({
  checkedAt: z.string().datetime(),
  overallStatus: z.enum(["ok", "attention", "unavailable"]),
  checks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      value: z.string().min(1),
      status: z.enum(["ok", "attention", "unavailable"]),
      measurement: z.enum(["live", "capability"]),
      measuredAt: z.string().datetime().optional(),
    }),
  ),
});

export const SnapshotSchema = z.object({
  case_count: z.number().int().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  total_connections: z.number().int().nonnegative(),
  max_connections: z.number().int().positive(),
  idle_in_transaction: z.number().int().nonnegative(),
  waiting_connections: z.number().int().nonnegative(),
  database_size_bytes: z.number().nonnegative(),
  postgres_version: z.string().min(1).max(64),
  ai_total: z.number().int().nonnegative(),
  ai_failures: z.number().int().nonnegative(),
  error_count: z.number().int().nonnegative(),
});

export type HealthSnapshot = z.infer<typeof SnapshotSchema>;

export const AI_FAILURE_ATTENTION_THRESHOLD_PERCENT = 10;

export function calculateAiSuccessRate(
  total: number,
  failures: number,
): number | null {
  if (!Number.isInteger(total) || total < 0) return null;
  if (!Number.isInteger(failures) || failures < 0 || failures > total) return null;
  if (total === 0) return null;
  return Math.round(((total - failures) / total) * 100);
}

export function getAiSuccessStatus(
  total: number,
  failures: number,
): PublicHealthStatus {
  if (!Number.isInteger(total) || total < 0) return "unavailable";
  if (!Number.isInteger(failures) || failures < 0 || failures > total) return "unavailable";
  if (total === 0) return "unavailable";
  // P5: Hranica chybovosti 10 % sa vyhodnocuje pred zaokrúhlením
  const failureRate = failures / total;
  return failureRate > AI_FAILURE_ATTENTION_THRESHOLD_PERCENT / 100
    ? "attention"
    : "ok";
}

export function getOverallHealthStatus(
  statuses: readonly PublicHealthStatus[],
): PublicHealthStatus {
  if (statuses.some((status) => status === "unavailable")) return "unavailable";
  if (statuses.some((status) => status === "attention")) return "attention";
  return "ok";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Nedostupné";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "Nedostupné" : `${value} %`;
}

const unavailable = (
  id: string,
  title: string,
  description: string,
  measurement: PublicHealthCheck["measurement"] = "live",
  measuredAt?: string,
): PublicHealthCheck => ({
  id,
  title,
  description,
  value: "Nedostupné",
  status: "unavailable",
  measurement,
  ...(measuredAt ? { measuredAt } : {}),
});

export function buildPublicHealthResponse(
  snapshot: z.infer<typeof SnapshotSchema> | null,
  storageBucketCount: number | null,
  storageAvailable: boolean,
  options?: {
    aiChatConfigured?: boolean;
    aiAnalysisConfigured?: boolean;
    s3Configured?: boolean;
    s3Available?: boolean;
  },
): PublicHealthResponse {
  const nowIso = new Date().toISOString();
  const checks: PublicHealthCheck[] = [];
  const aiChatConfigured = Boolean(options?.aiChatConfigured);
  const aiAnalysisConfigured = Boolean(options?.aiAnalysisConfigured);
  const s3Configured = Boolean(options?.s3Configured);
  const s3Available = options?.s3Available ?? s3Configured;

  checks.push({
    id: "application-server",
    title: "Aplikačný server",
    description: "Verejný health endpoint odpovedá.",
    value: "Dostupný",
    status: "ok",
    measurement: "live",
    measuredAt: nowIso,
  });

  if (snapshot) {
    const connectionStatus =
      snapshot.total_connections <= snapshot.max_connections
        ? "ok"
        : "attention";
    const aiRate = calculateAiSuccessRate(snapshot.ai_total, snapshot.ai_failures);
    const aiStatus = getAiSuccessStatus(snapshot.ai_total, snapshot.ai_failures);

    checks.push(
      {
        id: "database",
        title: "PostgreSQL databáza",
        description: "Pripojenie k databáze je funkčné.",
        value: "Dostupná",
        status: "ok",
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "case-storage",
        title: "Úložisko spisov",
        description: "Dotaz na evidenciu spisov funguje.",
        value: `${snapshot.case_count} ${snapshot.case_count === 1 ? "záznam" : "záznamov"}`,
        status: "ok",
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "database-latency",
        title: "Odozva databázy",
        description: "Čas odpovede databázového health dotazu.",
        value: `${snapshot.latency_ms} ms`,
        status: "ok",
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "database-connections",
        title: "Limit pripojení databázy",
        description: "Aktuálne použité pripojenia voči limitu PostgreSQL.",
        value: `${snapshot.total_connections} z ${snapshot.max_connections} pripojení`,
        status: connectionStatus,
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "idle-transactions",
        title: "Otvorené databázové transakcie",
        description: "Nečinné pripojenia v otvorenej transakcii.",
        value: `${snapshot.idle_in_transaction}`,
        status: snapshot.idle_in_transaction === 0 ? "ok" : "attention",
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "waiting-locks",
        title: "Čakanie na databázové zámky",
        description: "Pripojenia čakajúce na lock.",
        value: `${snapshot.waiting_connections}`,
        status: snapshot.waiting_connections === 0 ? "ok" : "attention",
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "database-size",
        title: "Veľkosť databázy",
        description: `PostgreSQL ${snapshot.postgres_version}.`,
        value: formatBytes(snapshot.database_size_bytes),
        status: "ok",
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "ai-telemetry",
        title: "Telemetria AI volaní",
        description: "Agregované záznamy AI volaní za posledných 24 hodín.",
        value: `${snapshot.ai_total} volaní`,
        status: "ok",
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "ai-success",
        title: "Úspešnosť AI za 24 hodín",
        description: "Úspešnosť sa označí ako vyžadujúca pozornosť pri viac než 10 % zlyhaní.",
        value:
          aiRate === null
            ? "Bez meraní"
            : `${aiRate} % úspešnosť (${snapshot.ai_failures} z ${snapshot.ai_total} zlyhaní)`,
        status: aiStatus,
        measurement: "live",
        measuredAt: nowIso,
      },
      {
        id: "system-errors",
        title: "Záznam systémových chýb",
        description: "Počet agregovaných chýb za posledných 24 hodín.",
        value: `${snapshot.error_count} udalostí`,
        status: snapshot.error_count === 0 ? "ok" : "attention",
        measurement: "live",
        measuredAt: nowIso,
      },
    );
  } else {
    checks.push(
      unavailable("database", "PostgreSQL databáza", "Databázový health snapshot sa nepodarilo načítať.", "live", nowIso),
      unavailable("case-storage", "Úložisko spisov", "Počet spisov sa nepodarilo overiť.", "live", nowIso),
      unavailable("database-latency", "Odozva databázy", "Odozvu databázy sa nepodarilo zmerať.", "live", nowIso),
      unavailable("database-connections", "Limit pripojení databázy", "Stav pripojení sa nepodarilo načítať.", "live", nowIso),
      unavailable("idle-transactions", "Otvorené databázové transakcie", "Stav transakcií sa nepodarilo načítať.", "live", nowIso),
      unavailable("waiting-locks", "Čakanie na databázové zámky", "Stav zámkov sa nepodarilo načítať.", "live", nowIso),
      unavailable("database-size", "Veľkosť databázy", "Veľkosť databázy sa nepodarilo načítať.", "live", nowIso),
      unavailable("ai-telemetry", "Telemetria AI volaní", "Telemetriu AI sa nepodarilo načítať.", "live", nowIso),
      unavailable("ai-success", "Úspešnosť AI za 24 hodín", "Úspešnosť AI sa nepodarilo vypočítať.", "live", nowIso),
      unavailable("system-errors", "Záznam systémových chýb", "Záznamy chýb sa nepodarilo načítať.", "live", nowIso),
    );
  }

  // P5: Rozlíšiť Supabase Storage od skutočného S3 trezoru príloh
  checks.push(
    {
      id: "document-storage",
      title: "Úložisko dokumentov (Supabase)",
      description: "Dostupnosť konfigurovaných Supabase storage bucketov.",
      value: storageAvailable && storageBucketCount !== null
        ? `${storageBucketCount} ${storageBucketCount === 1 ? "úložný priestor" : "úložných priestorov"}`
        : "Nedostupné",
      status: storageAvailable ? "ok" : "unavailable",
      measurement: "live",
      measuredAt: nowIso,
    },
    {
      id: "s3-vault",
      title: "S3 Trezor príloh",
      description: "Samostatné overenie dostupnosti externého Hetzner S3/WORM trezoru príloh.",
      value: s3Configured
        ? (s3Available ? "Aktívny (S3 WORM)" : "Nedostupný")
        : "Nenakonfigurovaný",
      status: s3Configured ? (s3Available ? "ok" : "unavailable") : "attention",
      measurement: "live",
      measuredAt: nowIso,
    },
    {
      id: "mistral-chat",
      title: "Mistral AI pre Copilota",
      description: "Konfigurácia serverového kľúča pre chat a kontroly.",
      value: aiChatConfigured ? "Nakonfigurovaný" : "Nenakonfigurovaný",
      status: aiChatConfigured ? "ok" : "attention",
      measurement: "capability",
      measuredAt: nowIso,
    },
    {
      id: "mistral-analysis",
      title: "Mistral AI pre analýzu a OCR",
      description: "Konfigurácia serverového kľúča pre analýzu dokumentov a OCR.",
      value: aiAnalysisConfigured ? "Nakonfigurovaný" : "Nenakonfigurovaný",
      status: aiAnalysisConfigured ? "ok" : "attention",
      measurement: "capability",
      measuredAt: nowIso,
    },
    {
      id: "pdf-export",
      title: "Forenzný PDF export",
      description: "Export prebieha lokálne v prehliadači a vytvára PDF aj SHA-256 manifest.",
      value: "Dostupný v prehliadači",
      status: "ok",
      measurement: "capability",
      measuredAt: nowIso,
    },
  );

  return {
    checkedAt: nowIso,
    overallStatus: getOverallHealthStatus(checks.map((check) => check.status)),
    checks,
  };
}

