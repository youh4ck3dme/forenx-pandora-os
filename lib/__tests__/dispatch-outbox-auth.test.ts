// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/forza/forenzx-dispatch-drain.server", () => ({
  drainForenzxDispatchOutbox: vi.fn().mockResolvedValue({
    skipped: false,
    drained: 0,
    sent: 0,
    failed: 0,
  }),
}));

const WEBHOOK_SECRET = "webhook-secret-value-32chars-exactly";
const CRON_SECRET = "cron-secret-value-exactly-32chars!!";

describe("GET|POST /api/forenzx/dispatch-outbox — auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FORENZX_WEBHOOK_SECRET: WEBHOOK_SECRET,
      CRON_SECRET,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("returns 401 with no auth on GET", async () => {
    const { GET } = await import("../../app/api/forenzx/dispatch-outbox/route");
    const req = new NextRequest("http://localhost/api/forenzx/dispatch-outbox", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong Bearer on POST", async () => {
    const { POST } = await import("../../app/api/forenzx/dispatch-outbox/route");
    const req = new NextRequest("http://localhost/api/forenzx/dispatch-outbox", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("accepts correct FORENZX_WEBHOOK_SECRET as Bearer", async () => {
    const { GET } = await import("../../app/api/forenzx/dispatch-outbox/route");
    const req = new NextRequest("http://localhost/api/forenzx/dispatch-outbox", {
      method: "GET",
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("accepts correct FORENZX_WEBHOOK_SECRET via x-forenzx-webhook-secret", async () => {
    const { POST } = await import("../../app/api/forenzx/dispatch-outbox/route");
    const req = new NextRequest("http://localhost/api/forenzx/dispatch-outbox", {
      method: "POST",
      headers: { "x-forenzx-webhook-secret": WEBHOOK_SECRET },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("accepts CRON_SECRET as Bearer", async () => {
    const { GET } = await import("../../app/api/forenzx/dispatch-outbox/route");
    const req = new NextRequest("http://localhost/api/forenzx/dispatch-outbox", {
      method: "GET",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("returns 401 when no secrets configured", async () => {
    process.env = { ...originalEnv };
    delete process.env.FORENZX_WEBHOOK_SECRET;
    delete process.env.CRON_SECRET;
    const { GET } = await import("../../app/api/forenzx/dispatch-outbox/route");
    const req = new NextRequest("http://localhost/api/forenzx/dispatch-outbox", {
      method: "GET",
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
