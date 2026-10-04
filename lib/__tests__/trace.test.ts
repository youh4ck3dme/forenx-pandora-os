// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  newTraceId,
  sanitizeForLog,
  tracedError,
  traceIdFromHeader,
  withTraceRoute,
  TRACE_HEADER,
} from "@/lib/forza/trace";
import { createServerFn } from "@/lib/tanstack-start-shim";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trace ids (P0-04)", () => {
  it("generuje UUIDv4 a nikdy sa neopakuje", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) ids.add(newTraceId());
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });

  it("prevezme platné x-trace-id z hlavičky, neplatné zahodí", () => {
    const valid = newTraceId();
    expect(traceIdFromHeader(valid)).toBe(valid);
    expect(traceIdFromHeader(`  ${valid}  `)).toBe(valid);
    expect(traceIdFromHeader("not-a-uuid")).toBeNull();
    expect(traceIdFromHeader("")).toBeNull();
    expect(traceIdFromHeader(null)).toBeNull();
  });

  it("withTraceRoute: echo platného trace id a vygeneruje nové pre neplatné", async () => {
    const inbound = newTraceId();
    const seenByHandler: string[] = [];

    const echo = await withTraceRoute(
      new Request("http://localhost/api/test", {
        headers: { [TRACE_HEADER]: inbound },
      }),
      async (traceId) => {
        seenByHandler.push(traceId);
        return new Response("ok");
      },
    );
    expect(echo.headers.get(TRACE_HEADER)).toBe(inbound);
    expect(seenByHandler).toEqual([inbound]);

    const generated = await withTraceRoute(
      new Request("http://localhost/api/test", {
        headers: { [TRACE_HEADER]: "attack-not-uuid" },
      }),
      async (traceId) => {
        seenByHandler.push(traceId);
        return new Response("ok");
      },
    );
    const generatedId = generated.headers.get(TRACE_HEADER);
    expect(generatedId).toMatch(UUID_RE);
    expect(generatedId).not.toBe("attack-not-uuid");
    expect(seenByHandler[1]).toBe(generatedId);
  });
});

describe("sanitizeForLog — logy bez PII a API kľúčov (P0-04)", () => {
  it("rediguje PII", () => {
    const out = sanitizeForLog(
      "Zápisnica: rodné číslo 800101/0006, IBAN SK3112000000198742637541, svedok Ján Novák.",
    );
    expect(out).toContain("[RODNÉ_ČÍSLO]");
    expect(out).toContain("[IBAN]");
    expect(out).toContain("svedok [SUBJEKT]");
    expect(out).not.toContain("800101");
    expect(out).not.toContain("Novák");
  });

  it("maskuje bearer tokeny a API kľúče", () => {
    const out = sanitizeForLog(
      'Headers: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def, key "sk-mistral-AbCdEf123456", {"api_key": "super-secret-value"}',
    );
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).toContain("[REDACTED_API_KEY]");
    expect(out).toContain("[REDACTED_SECRET]");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).not.toContain("AbCdEf123456");
    expect(out).not.toContain("super-secret-value");
  });

  it("akceptuje Error objekty a skracuje dlhé hodnoty", () => {
    const out = sanitizeForLog(new Error("Krátka chybová správa"));
    expect(out).toContain("Krátka chybová správa");
    const long = sanitizeForLog("x".repeat(10_000));
    expect(long.length).toBeLessThanOrEqual(4200);
    expect(long).toContain("[truncated]");
  });
});

describe("tracedError (P0-04)", () => {
  it("loguje s trace prefixom a bez tajomstiev", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const traceId = newTraceId();
    tracedError(traceId, "Vault verification failed", {
      authorization: "Bearer sk-super-secret-token",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.join(" ");
    expect(line).toContain(`[trace:${traceId}]`);
    expect(line).toContain("Vault verification failed");
    expect(line).not.toContain("sk-super-secret-token");
  });
});

describe("propagácia trace id do LLM volaní (P0-04)", () => {
  it("mistral-client posiela x-trace-id hlavičku", async () => {
    const { createChatCompletionStream } = await import("@/lib/ai/mistral-client");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const traceId = newTraceId();
    const result = await createChatCompletionStream(
      [{ role: "user", content: "Analýza" }],
      "mistral_live_secret_key_998877665544",
      { traceId },
    );
    expect(result.ok).toBe(true);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-trace-id")).toBe(traceId);
    vi.unstubAllGlobals();
  });

  it("callMistral posiela x-trace-id poskytovateľovi (server)", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "test-mistral-key-1234567890");
    const { callMistral } = await import("@/lib/forza/ai/mistral.server");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
      }),
    );

    const traceId = newTraceId();
    await callMistral({
      messages: [{ role: "user", content: "Test" }],
      traceId,
      fetchImpl,
    });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-trace-id")).toBe(traceId);
    vi.unstubAllEnvs();
  });
});

describe("serverové funkcie majú trace id (P0-04)", () => {
  it("createServerFn handler dostane context.traceId (UUIDv4)", async () => {
    const fn = createServerFn({ method: "POST" }).handler(
      async ({ context }) => context.traceId as string,
    );
    const first = await fn();
    const second = await fn();
    expect(first).toMatch(UUID_RE);
    expect(second).toMatch(UUID_RE);
    expect(first).not.toBe(second);
  });
});
