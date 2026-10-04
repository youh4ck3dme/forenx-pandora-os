import { describe, expect, it } from "vitest";
import {
  commitAiGraph,
  type GraphCommitRpc,
} from "../case-graph-commit";

const validInput = {
  actor: "22222222-2222-4222-8222-222222222222",
  caseId: "11111111-1111-4111-8111-111111111111",
  entities: [],
  events: [],
  relations: [],
};

function rpc(response: {
  data: unknown;
  error: { code: string; message: string } | null;
}): GraphCommitRpc {
  return async () => response;
}

describe("atomic AI graph commit", () => {
  it("returns a migration-missing result rather than treating the write as successful", async () => {
    const result = await commitAiGraph(
      rpc({
        data: null,
        error: {
          code: "42883",
          message: "function public.commit_ai_case_graph does not exist",
        },
      }),
      validInput,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "migration_missing",
        message: "Kritická databázová migrácia pre zápis grafu nie je nasadená.",
      },
    });
  });

  it("rejects an invalid RPC response instead of casting it to a success", async () => {
    const result = await commitAiGraph(
      rpc({
        data: { entities: "one", events: 0, relations: 0 },
        error: null,
      }),
      validInput,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalid_response" },
    });
  });

  it("returns validated commit counts", async () => {
    const result = await commitAiGraph(
      rpc({
        data: { entities: 2, events: 1, relations: 1 },
        error: null,
      }),
      validInput,
    );

    expect(result).toEqual({
      ok: true,
      value: { entities: 2, events: 1, relations: 1 },
    });
  });
});
