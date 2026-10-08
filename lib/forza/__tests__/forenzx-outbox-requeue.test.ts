// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  userId: "user-owner",
  rows: [] as Array<{ id: string; case_id: string | null; status: string; attempts: number }>,
  updates: 0,
  caseOwner: "user-owner" as string | null,
  admin: false,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getUser: async () => ({ data: { user: { id: h.userId } }, error: null }),
    },
    from(table: string) {
      if (table === "forenzx_dispatch_outbox") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: h.rows, error: null }),
            }),
          }),
          update: () => {
            h.updates += 1;
            return { in: () => ({ eq: async () => ({ error: null }) }) };
          },
        };
      }
      if (table === "cases") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: h.caseOwner ? { id: "case-1", user_id: h.caseOwner } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: h.admin ? { role: "admin" } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "case_audit_log") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const OUTBOX = "11111111-1111-4111-8111-111111111111";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/forenzx/outbox/requeue", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/forenzx/outbox/requeue authorization", () => {
  beforeEach(() => {
    h.userId = "user-owner";
    h.rows = [];
    h.updates = 0;
    h.caseOwner = "user-owner";
    h.admin = false;
  });

  it("does not requeue a failed row that has no case_id", async () => {
    h.rows = [{ id: OUTBOX, case_id: null, status: "failed", attempts: 8 }];
    const { POST } = await import("@/app/api/forenzx/outbox/requeue/route");
    const res = await POST(post({ outbox_id: OUTBOX }));
    expect(res.status).toBe(403);
    expect(h.updates).toBe(0);
  });

  it("does not requeue another user's failed dispatch", async () => {
    h.caseOwner = "someone-else";
    h.rows = [{ id: OUTBOX, case_id: "22222222-2222-4222-8222-222222222222", status: "failed", attempts: 8 }];
    const { POST } = await import("@/app/api/forenzx/outbox/requeue/route");
    const res = await POST(post({ outbox_id: OUTBOX }));
    expect(res.status).toBe(403);
    expect(h.updates).toBe(0);
  });

  it("requeues a failed dispatch owned by the caller", async () => {
    h.rows = [{ id: OUTBOX, case_id: "22222222-2222-4222-8222-222222222222", status: "failed", attempts: 8 }];
    const { POST } = await import("@/app/api/forenzx/outbox/requeue/route");
    const res = await POST(post({ outbox_id: OUTBOX }));
    expect(res.status).toBe(200);
    expect(h.updates).toBe(1);
    expect(await res.json()).toMatchObject({ ok: true, requeued: 1 });
  });

  it("allows an admin to requeue a row with no case_id", async () => {
    h.admin = true;
    h.rows = [{ id: OUTBOX, case_id: null, status: "failed", attempts: 8 }];
    const { POST } = await import("@/app/api/forenzx/outbox/requeue/route");
    const res = await POST(post({ outbox_id: OUTBOX }));
    expect(res.status).toBe(200);
    expect(h.updates).toBe(1);
  });
});
