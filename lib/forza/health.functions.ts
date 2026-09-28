// Serverové funkcie pre administrátorský prehľad stavu systému.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DbHealth = {
  max_connections: number;
  total_connections: number;
  active_connections: number;
  idle_connections: number;
  idle_in_transaction: number;
  waiting_connections: number;
  database_size_bytes: number;
  postgres_version: string;
};

export type AiFeatureStat = {
  feature: string;
  total: number;
  failures: number;
  avgDurationMs: number | null;
  lastAt: string | null;
};

export type AiInvocation = {
  id: string;
  created_at: string;
  feature: string;
  success: boolean;
  duration_ms: number | null;
  provider: string | null;
  model: string | null;
  error_message: string | null;
  input_summary: string | null;
};

export type SystemErrorLog = {
  id: string;
  created_at: string;
  route: string | null;
  message: string;
  severity: string;
  source: string;
};

export type SystemHealth = {
  checkedAt: string;
  database: {
    ok: boolean;
    latencyMs: number;
    error?: string;
    stats?: DbHealth;
  };
  ai: {
    windowHours: number;
    total: number;
    failures: number;
    avgDurationMs: number | null;
    byFeature: AiFeatureStat[];
    recent: AiInvocation[];
    error?: string;
  };
  errors: {
    recent: SystemErrorLog[];
    error?: string;
  };
};

const WINDOW_HOURS = 24;

/** Prehľad stavu databázy, pripojení a AI volaní. Len pre administrátora. */
export const getSystemHealth = createServerFn({ method: "GET", id: "health/getSystemHealth" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SystemHealth> => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw new Error("Overenie oprávnení zlyhalo.");
    if (!isAdmin) throw new Error("Prístup majú iba administrátori.");

    // 1) Dostupnosť a odozva databázy
    const started = Date.now();
    let dbOk = true;
    let dbError: string | undefined;
    const { error: pingError } = await supabase
      .from("cases")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (pingError) {
      dbOk = false;
      dbError = pingError.message;
    }
    const latencyMs = Date.now() - started;

    // 2) Stav pripojení (pooler / Postgres)
    let stats: DbHealth | undefined;
    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data: statsData, error: statsError } =
      await supabaseAdmin.rpc("db_health_stats");
    if (statsError) {
      dbError = dbError ?? statsError.message;
    } else if (statsData) {
      stats = statsData as unknown as DbHealth;
    }

    // 3) AI volania za posledných 24 hodín
    const since = new Date(
      Date.now() - WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const ai: SystemHealth["ai"] = {
      windowHours: WINDOW_HOURS,
      total: 0,
      failures: 0,
      avgDurationMs: null,
      byFeature: [],
      recent: [],
    };

    const { data: logs, error: logsError } = await supabase
      .from("ai_feature_logs")
      .select(
        "id, created_at, feature, success, duration_ms, provider, model, error_message, input_summary",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    if (logsError) {
      ai.error = logsError.message;
    } else {
      const rows = (logs ?? []) as unknown as AiInvocation[];
      ai.total = rows.length;
      ai.failures = rows.filter((r) => !r.success).length;
      const durations = rows
        .map((r) => r.duration_ms)
        .filter((d): d is number => typeof d === "number");
      ai.avgDurationMs = durations.length
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : null;

      const map = new Map<string, { rows: AiInvocation[] }>();
      for (const row of rows) {
        const bucket = map.get(row.feature) ?? { rows: [] };
        bucket.rows.push(row);
        map.set(row.feature, bucket);
      }
      ai.byFeature = [...map.entries()]
        .map(([feature, bucket]) => {
          const d = bucket.rows
            .map((r) => r.duration_ms)
            .filter((v): v is number => typeof v === "number");
          return {
            feature,
            total: bucket.rows.length,
            failures: bucket.rows.filter((r) => !r.success).length,
            avgDurationMs: d.length
              ? Math.round(d.reduce((s, v) => s + v, 0) / d.length)
              : null,
            lastAt: bucket.rows[0]?.created_at ?? null,
          };
        })
        .sort((a, b) => b.total - a.total);
      ai.recent = rows.slice(0, 20);
    }

    const errors: SystemHealth["errors"] = { recent: [] };
    const { data: errorRows, error: errorLogsError } = await supabase
      .from("error_logs")
      .select("id, created_at, route, message, severity, source")
      .order("created_at", { ascending: false })
      .limit(5);

    if (errorLogsError) {
      errors.error = errorLogsError.message;
    } else {
      errors.recent = (errorRows ?? []) as SystemErrorLog[];
    }

    return {
      checkedAt: new Date().toISOString(),
      database: {
        ok: dbOk,
        latencyMs,
        ...(dbError ? { error: dbError } : {}),
        ...(stats ? { stats } : {}),
      },
      ai,
      errors,
    };
  });
