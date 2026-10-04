import { z } from "zod";
import type {
  GraphEntityInsert,
  GraphEventInsert,
  GraphRelationInsert,
} from "@/lib/forza/case-graph-plan";

const uuidSchema = z.string().uuid();
const isoDate = z.string().regex(/^d{4}-d{2}-d{2}$/);

const graphCommitInputSchema = z
  .object({
    actor: uuidSchema,
    correlationId: z.string().min(1).max(100).optional(),
    caseId: uuidSchema,
    entities: z.array(
      z
        .object({
          id: uuidSchema,
          case_id: uuidSchema,
          user_id: uuidSchema,
          name: z.string().min(1).max(160),
          kind: z.enum(["person", "company"]),
          role: z.string().max(120),
          identity_key: z.string().max(400).nullable(),
          x: z.number().finite(),
          y: z.number().finite(),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          id: uuidSchema,
          case_id: uuidSchema,
          user_id: uuidSchema,
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          title: z.string().min(1).max(160),
          detail: z.string().max(600),
          severity: z.string().min(1).max(30),
        })
        .strict(),
    ),
    relations: z.array(
      z
        .object({
          id: uuidSchema,
          case_id: uuidSchema,
          user_id: uuidSchema,
          from_id: uuidSchema,
          to_id: uuidSchema,
          label: z.string().min(1).max(80),
          valid_from: isoDate.nullable(),
          valid_to: isoDate.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const graphCommitSuccessSchema = z
  .object({
    entities: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    relations: z.number().int().nonnegative(),
  })
  .strict();

export type GraphCommitInput = {
  actor: string;
  correlationId?: string;
  caseId: string;
  entities: GraphEntityInsert[];
  events: GraphEventInsert[];
  relations: GraphRelationInsert[];
};

export type GraphCommitSuccess = z.infer<typeof graphCommitSuccessSchema>;

export type GraphCommitError =
  | {
      kind: "invalid_input";
      message: string;
    }
  | {
      kind: "migration_missing";
      message: string;
    }
  | {
      kind: "access_denied";
      message: string;
    }
  | {
      kind: "database_error";
      code: string;
      message: string;
    }
  | {
      kind: "invalid_response";
      message: string;
    };

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

type RpcResponse = {
  data: unknown;
  error: { code: string; message: string } | null;
};

export type GraphCommitRpc = (args: {
  _actor: string;
  _case: string;
  _entities: GraphEntityInsert[];
  _events: GraphEventInsert[];
  _relations: GraphRelationInsert[];
  _correlation?: string;
}) => Promise<RpcResponse>;

export async function commitAiGraph(
  rpc: GraphCommitRpc,
  input: GraphCommitInput,
): Promise<Result<GraphCommitSuccess, GraphCommitError>> {
  const parsedInput = graphCommitInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: {
        kind: "invalid_input",
        message: "Neplatný payload pre atómový zápis grafu.",
      },
    };
  }

  const { actor, caseId, correlationId, entities, events, relations } =
    parsedInput.data;
  const { data, error } = await rpc({
    _actor: actor,
    _case: caseId,
    _entities: entities,
    _events: events,
    _relations: relations,
    ...(correlationId ? { _correlation: correlationId } : {}),
  });
  if (error) {
    if (error.code === "42883") {
      return {
        ok: false,
        error: {
          kind: "migration_missing",
          message: "Kritická databázová migrácia pre zápis grafu nie je nasadená.",
        },
      };
    }
    if (error.code === "42501") {
      return {
        ok: false,
        error: {
          kind: "access_denied",
          message: "Nemáte oprávnenie zapísať tento prípad.",
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "database_error",
        code: error.code,
        message: error.message,
      },
    };
  }

  const parsedResponse = graphCommitSuccessSchema.safeParse(data);
  if (!parsedResponse.success) {
    return {
      ok: false,
      error: {
        kind: "invalid_response",
        message: "Databáza vrátila neplatný výsledok atómového zápisu grafu.",
      },
    };
  }
  return { ok: true, value: parsedResponse.data };
}
