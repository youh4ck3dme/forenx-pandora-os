// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createServerFn, getRequest } from "@/lib/tanstack-start-shim";
import { handleServerFnRequest } from "@/lib/server-fn/handle.server";
import { buildServerFnRegistry, type RegisteredServerFn } from "@/lib/server-fn/registry.server";

const echoHeaders = createServerFn({ method: "POST", id: "test/echo" })
  .validator((d: unknown) => z.object({ value: z.string().max(5, "Príliš dlhé.") }).parse(d))
  .handler(async ({ data }) => ({
    value: data.value,
    authorization: getRequest()?.headers.get("authorization") ?? null,
  }));

const lookup = (id: string) =>
  id === "test/echo" ? (echoHeaders as unknown as RegisteredServerFn) : undefined;

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/fn/test/echo", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("server function registry", () => {
  it("registers every exported server function under its module/export id", () => {
    const registry = buildServerFnRegistry();
    expect(registry.size).toBe(39);
    for (const [id, fn] of registry) {
      expect(fn.id).toBe(id);
      expect(id).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9_]+$/);
    }
    expect(registry.has("ai/runForensicAutopilot")).toBe(true);
    expect(registry.has("case-write/saveCase")).toBe(true);
  });

  it("refuses a function whose id does not match its export", () => {
    const wrong = createServerFn({ id: "other/name" }).handler(async () => null);
    expect(() => buildServerFnRegistry({ mod: { fn: wrong } })).toThrow(/nesprávne id/);
    const missing = createServerFn().handler(async () => null);
    expect(() => buildServerFnRegistry({ mod: { fn: missing } })).toThrow(/nesprávne id/);
  });
});

describe("handleServerFnRequest", () => {
  it("runs the handler on the server with the real request headers", async () => {
    const res = await handleServerFnRequest(post({ data: { value: "abc" } }, { authorization: "Bearer t.k.n" }), "test/echo", { lookup, isProduction: true });
    expect(res).toEqual({ status: 200, body: { ok: true, result: { value: "abc", authorization: "Bearer t.k.n" } } });
  });

  it("rejects unknown or malformed ids", async () => {
    expect((await handleServerFnRequest(post({}), "test/missing", { lookup })).status).toBe(404);
    expect((await handleServerFnRequest(post({}), "../etc", { lookup })).status).toBe(404);
  });

  it("in production refuses a request without a Bearer token before reading the body", async () => {
    const fn = vi.fn();
    const res = await handleServerFnRequest(post({ data: { value: "a" } }), "test/echo", {
      lookup: () => fn as unknown as RegisteredServerFn,
      isProduction: true,
    });
    expect(res.status).toBe(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it("enforces the body size limit", async () => {
    const res = await handleServerFnRequest(post({ data: { value: "x".repeat(200) } }), "test/echo", { lookup, maxBodyBytes: 100 });
    expect(res.status).toBe(413);
  });

  it("maps invalid JSON, validation, auth and handler errors", async () => {
    expect((await handleServerFnRequest(post("{nope"), "test/echo", { lookup })).status).toBe(400);
    expect(await handleServerFnRequest(post({ data: { value: "toolong" } }), "test/echo", { lookup })).toEqual({
      status: 400,
      body: { ok: false, error: "Príliš dlhé." },
    });
    const unauthorized = createServerFn({ id: "test/echo" }).handler(async () => {
      throw new Error("Unauthorized: Invalid token");
    });
    expect(
      (await handleServerFnRequest(post({}), "test/echo", { lookup: () => unauthorized as unknown as RegisteredServerFn })).status,
    ).toBe(401);
    const failing = createServerFn({ id: "test/echo" }).handler(async () => {
      throw new Error("Prípad sa nenašiel.");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await handleServerFnRequest(post({}), "test/echo", { lookup: () => failing as unknown as RegisteredServerFn })).toEqual({
      status: 500,
      body: { ok: false, error: "Prípad sa nenašiel." },
    });
    const misconfigured = createServerFn({ id: "test/echo" }).handler(async () => {
      throw new Error("Missing Supabase environment variable(s): SUPABASE_URL.");
    });
    expect(await handleServerFnRequest(post({}), "test/echo", { lookup: () => misconfigured as unknown as RegisteredServerFn })).toEqual({
      status: 500,
      body: { ok: false, error: "Server nie je správne nakonfigurovaný." },
    });
    errorSpy.mockRestore();
  });
});
