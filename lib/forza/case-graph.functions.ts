import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAiGraphPlan,
  type AiGraphInput,
} from "@/lib/forza/case-graph-plan";

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
    return `${dotted[3]}-${dotted[2]!.padStart(2, "0")}-${dotted[1]!.padStart(2, "0")}`;
  }
  const monthOnly = text.match(/^(\d{4})-(\d{2})$/);
  if (monthOnly) return `${monthOnly[1]}-${monthOnly[2]}-01`;
  const yearOnly = text.match(/^(\d{4})$/);
  if (yearOnly) return `${yearOnly[1]}-01-01`;
  return null;
}

export const applyAiResultsToCase = createServerFn({ method: "POST" })
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
          .select("from_id, to_id, label")
          .eq("case_id", data.caseId),
      ]);
    if (entitiesError || eventsError || relationsError) {
      const error = entitiesError ?? eventsError ?? relationsError;
      throw new Error(`Dáta prípadu sa nepodarilo načítať. (${error.message})`);
    }

    const fallbackDate =
      (caseRow as { reference_date?: string }).reference_date ??
      new Date().toISOString().slice(0, 10);
    const plan = buildAiGraphPlan(
      data as AiGraphInput,
      context.userId,
      fallbackDate,
      entities ?? [],
      events ?? [],
      relations ?? [],
    );

    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("commit_ai_case_graph", {
      _actor: context.userId,
      _case: data.caseId,
      _entities: plan.entities,
      _events: plan.events,
      _relations: plan.relations,
    });
    if (error) {
      throw new Error(
        `Výsledky AI sa nepodarilo zapísať atómovo. Nezapísal sa žiadny riadok. (${error.message})`,
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
  const facts = (dossier as { facts?: { timeline?: unknown[] } })?.facts;
  const rows = Array.isArray(facts?.timeline) ? facts.timeline : [];
  const out: {
    date?: string;
    event?: string;
    detail?: string;
    actors?: string[];
  }[] = [];
  for (const raw of rows.slice(0, 200)) {
    const row = raw as {
      date?: unknown;
      event?: unknown;
      title?: unknown;
      description?: unknown;
      detail?: unknown;
      actors?: unknown;
      persons?: unknown;
      entities?: unknown;
    };
    const text = (value: unknown) =>
      typeof value === "string" ? value.trim() : "";
    const event = text(row.event) || text(row.title);
    const detail = text(row.detail) || text(row.description);
    if (!event && !detail) continue;
    const actorsRaw = [row.actors, row.persons, row.entities].find(
      Array.isArray,
    ) as unknown[] | undefined;
    const actors = (actorsRaw ?? [])
      .map((actor) =>
        typeof actor === "string"
          ? actor.trim()
          : text((actor as { name?: unknown })?.name),
      )
      .filter(Boolean)
      .slice(0, 20);
    out.push({
      ...(text(row.date) ? { date: text(row.date) } : {}),
      ...(event ? { event } : {}),
      ...(detail ? { detail } : {}),
      ...(actors.length ? { actors } : {}),
    });
  }
  return out;
}
