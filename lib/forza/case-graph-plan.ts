export type AiGraphPerson = {
  name: string;
  role?: string;
  dateOfBirth?: string;
  sourceIdentity?: string;
};

export type AiGraphInput = {
  caseId: string;
  persons: AiGraphPerson[];
  companies: string[];
  timeline: {
    date?: string;
    /** Koniec obdobia platnosti (napr. koniec funkčného obdobia). */
    endDate?: string;
    event?: string;
    detail?: string;
    actors?: string[];
  }[];
};

type ExistingEntity = {
  id: string;
  name: string;
  identity_key: string | null;
};

type ExistingRelation = {
  from_id: string | null;
  to_id: string | null;
  label: string;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type GraphEntityInsert = {
  id: string;
  case_id: string;
  user_id: string;
  name: string;
  kind: string;
  role: string;
  identity_key: string | null;
  x: number;
  y: number;
};

export type GraphEventInsert = {
  id: string;
  case_id: string;
  user_id: string;
  date: string;
  title: string;
  detail: string;
  severity: string;
};

export type GraphRelationInsert = {
  id: string;
  case_id: string;
  user_id: string;
  from_id: string;
  to_id: string;
  label: string;
  /** Začiatok obdobia, v ktorom vzťah platil (dátum udalosti). */
  valid_from: string | null;
  valid_to: string | null;
};

const MAX_ENTITIES = 60;
const MAX_EVENTS = 60;
const MAX_RELATIONS = 80;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function personIdentityKey(person: AiGraphPerson): string | null {
  if (person.sourceIdentity) {
    return `source:${normalizeKey(person.sourceIdentity)}`;
  }
  if (person.dateOfBirth) {
    return `person:${normalizeKey(person.name)}|born:${person.dateOfBirth}`;
  }
  return null;
}

function normalizeDate(raw: string | undefined): string | null {
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

export function buildAiGraphPlan(
  data: AiGraphInput,
  userId: string,
  fallbackDate: string,
  existingEntities: ExistingEntity[],
  existingEvents: { date: string; title: string }[],
  existingRelations: ExistingRelation[],
  createId: () => string = () => crypto.randomUUID(),
) {
  const entitiesByIdentity = new Map<string, string>();
  const entityIdsByName = new Map<string, string[]>();
  for (const row of existingEntities) {
    if (row.identity_key) entitiesByIdentity.set(row.identity_key, row.id);
    const key = normalizeKey(row.name);
    entityIdsByName.set(key, [...(entityIdsByName.get(key) ?? []), row.id]);
  }

  const entities: GraphEntityInsert[] = [];
  const queuedIdentity = new Set<string>();
  const queue = (
    name: string,
    kind: "person" | "company",
    role: string,
    identityKey: string | null,
  ) => {
    if (entities.length >= MAX_ENTITIES) return;
    if (
      identityKey &&
      (entitiesByIdentity.has(identityKey) || queuedIdentity.has(identityKey))
    ) {
      return;
    }
    if (identityKey) queuedIdentity.add(identityKey);
    const index = entities.length;
    const id = createId();
    entities.push({
      id,
      case_id: data.caseId,
      user_id: userId,
      name: name.trim(),
      kind,
      role,
      identity_key: identityKey,
      x: 80 + (index % 5) * 90,
      y: 80 + Math.floor(index / 5) * 90,
    });
    const key = normalizeKey(name);
    entityIdsByName.set(key, [...(entityIdsByName.get(key) ?? []), id]);
  };

  for (const person of data.persons) {
    queue(
      person.name,
      "person",
      person.role?.trim() || "osoba",
      personIdentityKey(person),
    );
  }
  for (const company of data.companies) {
    queue(company, "company", "firma", null);
  }

  const eventKeys = new Set(
    existingEvents.map((row) => `${row.date}|${normalizeKey(row.title)}`),
  );
  const events: GraphEventInsert[] = [];
  const candidates: Omit<GraphRelationInsert, "id">[] = [];
  for (const item of data.timeline) {
    const title = (item.event ?? item.detail ?? "").trim();
    if (!title) continue;
    const date = normalizeDate(item.date) ?? fallbackDate;
    const validFrom = normalizeDate(item.date);
    const endDate = normalizeDate(item.endDate);
    const validTo = endDate && validFrom && endDate < validFrom ? null : endDate;
    const key = `${date}|${normalizeKey(title)}`;
    if (!eventKeys.has(key) && events.length < MAX_EVENTS) {
      eventKeys.add(key);
      events.push({
        id: createId(),
        case_id: data.caseId,
        user_id: userId,
        date,
        title: title.slice(0, 160),
        detail: (item.detail ?? item.event ?? "").slice(0, 600),
        severity: "medium",
      });
    }
    const actorIds: string[] = [];
    for (const actor of item.actors ?? []) {
      const ids = entityIdsByName.get(normalizeKey(actor));
      const id = ids?.length === 1 ? ids[0] : undefined;
      if (id) actorIds.push(id);
    }
    for (let i = 0; i < actorIds.length; i++) {
      for (let j = i + 1; j < actorIds.length; j++) {
        const fromId = actorIds[i];
        const toId = actorIds[j];
        if (!fromId || !toId) continue;
        candidates.push({
          case_id: data.caseId,
          user_id: userId,
          from_id: fromId,
          to_id: toId,
          label: title.slice(0, 80) || "spoločná udalosť",
          valid_from: validFrom,
          valid_to: validTo,
        });
      }
    }
  }

  // Obdobie platnosti je súčasťou kľúča: rovnaký vzťah v inom období je
  // samostatný historický záznam, nikdy sa neprepíše.
  const relationKey = (relation: ExistingRelation) =>
    relation.from_id && relation.to_id
      ? [
          [relation.from_id, relation.to_id].sort().join("|"),
          normalizeKey(relation.label),
          relation.valid_from ?? "",
          relation.valid_to ?? "",
        ].join("|")
      : null;
  const relationKeys = new Set(
    existingRelations
      .map(relationKey)
      .filter((key): key is string => Boolean(key)),
  );
  const relations: GraphRelationInsert[] = [];
  for (const relation of candidates) {
    const key = relationKey(relation);
    if (!key || relationKeys.has(key) || relations.length >= MAX_RELATIONS) continue;
    relationKeys.add(key);
    relations.push({ ...relation, id: createId() });
  }

  return { entities, events, relations };
}
