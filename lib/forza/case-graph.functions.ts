import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAiGraphPlan,
} from "@/lib/forza/case-graph-plan";
import { commitAiGraph } from "@/lib/forza/case-graph-commit";

const nameSchema = z.string().trim().min(2).max(160);

const inputSchema = z.object({
  caseId: z.string().uuid("Neplatný identifikátor prípadu."),
  persons: z
    .array(
      z.object({
        name: nameSchema,
        role: z.string().trim().max(120).optional(),
        dateOfBirth: z.string().date().optional(),
        sourceIdentity: z.string().trim().min(2).max(160).optional(),
      }),
    )
    .max(200)
    .default([]),
  companies: z.array(nameSchema).max(200).default([]),
  timeline: z
    .array(
      z.object({
        date: z.string().trim().max(60).optional(),
        endDate: z.string().trim().max(60).optional(),
        event: z.string().trim().max(400).optional(),
        detail: z.string().trim().max(1000).optional(),
        actors: z.array(z.string().trim().max(160)).max(20).optional(),
      }),
    )
    .max(200)
    .default([]),
});

export type ApplyAiResultsInput = z.input<typeof inputSchema>;

export function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = text.match(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/);
  if (dotted) {
    const [, day, month, year] = dotted;
    if (day && month && year) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return null;
  }
  const monthOnly = text.match(/^(\d{4})-(\d{2})$/);
  if (monthOnly) return `${monthOnly[1]}-${monthOnly[2]}-01`;
  const yearOnly = text.match(/^(\d{4})$/);
  if (yearOnly) return `${yearOnly[1]}-01-01`;
  return null;
}

export const applyAiResultsToCase = createServerFn({ method: "POST", id: "case-graph/applyAiResultsToCase" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: caseRow, error: caseError } = await supabase
      .from("cases")
      .select("id, reference_date")
      .eq("id", data.caseId)
      .maybeSingle();
    if (caseError) {
      throw new Error(`Prípad sa nepodarilo načítať. (${caseError.message})`);
    }
    if (!caseRow) {
      throw new Error("Prípad sa nenašiel alebo naň nemáte oprávnenie.");
    }

    const [{ data: entities, error: entitiesError }, { data: events, error: eventsError }, { data: relations, error: relationsError }] =
      await Promise.all([
        supabase
          .from("case_entities")
          .select("id, name, identity_key")
          .eq("case_id", data.caseId),
        supabase
          .from("case_events")
          .select("date, title")
          .eq("case_id", data.caseId),
        supabase
          .from("case_relations")
          .select("from_id, to_id, label, valid_from, valid_to")
          .eq("case_id", data.caseId),
      ]);
    if (entitiesError || eventsError || relationsError) {
      const error = entitiesError ?? eventsError ?? relationsError;
      throw new Error(`Dáta prípadu sa nepodarilo načítať. (${error?.message ?? "Neznáma chyba"})`);
    }

    const fallbackDate = caseRow.reference_date ?? new Date().toISOString().slice(0, 10);
    const plan = buildAiGraphPlan(
      data,
      context.userId,
      fallbackDate,
      entities ?? [],
      events ?? [],
      relations ?? [],
    );

    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const result = await commitAiGraph(
      async (args) => await supabaseAdmin.rpc("commit_ai_case_graph", args),
      {
        actor: context.userId,
        correlationId: crypto.randomUUID(),
        caseId: data.caseId,
        entities: plan.entities,
        events: plan.events,
        relations: plan.relations,
      },
    );
    if (!result.ok) {
      throw new Error(
        `Výsledky AI sa nepodarilo zapísať atómovo. Nezapísal sa žiadny riadok. (${result.error.message})`,
      );
    }
    return {
      entities: plan.entities.length,
      events: plan.events.length,
      relations: plan.relations.length,
    };
  });

export function toTimelineInput(dossier: unknown): {
  date?: string;
  event?: string;
  detail?: string;
  actors?: string[];
}[] {
  const timelineSchema = z.object({
    facts: z
      .object({
        timeline: z.array(z.unknown()).optional(),
      })
      .optional(),
  });
  const parsedDossier = timelineSchema.safeParse(dossier);
  const rows = parsedDossier.success
    ? (parsedDossier.data.facts?.timeline ?? [])
    : [];
  const out: {
    date?: string;
    event?: string;
    detail?: string;
    actors?: string[];
  }[] = [];
  for (const raw of rows.slice(0, 200)) {
    const rowSchema = z.object({
      date: z.unknown().optional(),
      event: z.unknown().optional(),
      title: z.unknown().optional(),
      description: z.unknown().optional(),
      detail: z.unknown().optional(),
      actors: z.unknown().optional(),
      persons: z.unknown().optional(),
      entities: z.unknown().optional(),
    });
    const parsedRow = rowSchema.safeParse(raw);
    if (!parsedRow.success) continue;
    const row = parsedRow.data;
    const text = (value: unknown) =>
      typeof value === "string" ? value.trim() : "";
    const event = text(row.event) || text(row.title);
    const detail = text(row.detail) || text(row.description);
    if (!event && !detail) continue;
    const actorListSchema = z.array(
      z.union([
        z.string(),
        z.object({ name: z.unknown().optional() }),
      ]),
    );
    const actorsRaw = [row.actors, row.persons, row.entities]
      .map((value) => actorListSchema.safeParse(value))
      .find((result) => result.success);
    const actors = actorsRaw?.success
      ? actorsRaw.data
          .map((actor) =>
            typeof actor === "string" ? actor.trim() : text(actor.name),
          )
          .filter(Boolean)
          .slice(0, 20)
      : [];
    out.push({
      ...(text(row.date) ? { date: text(row.date) } : {}),
      ...(event ? { event } : {}),
      ...(detail ? { detail } : {}),
      ...(actors.length ? { actors } : {}),
    });
  }
  return out;
}
