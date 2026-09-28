/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { callServerFnRemote, createServerFn, serverFnBaseUrl } from "@/lib/tanstack-start-shim";

vi.mock("@/lib/forza/access-audit", () => ({ getSupabaseSessionToken: async () => "user.jwt.token" }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("server functions in the browser", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("never runs the handler in the browser — it calls /api/fn/<id> with the user's token", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn(async () => json(200, { ok: true, result: { saved: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn(async () => ({ saved: "locally" }));
    const fn = createServerFn({ method: "POST", id: "case-write/saveCase" }).handler(handler);

    await expect(fn({ data: { title: "Prípad" } })).resolves.toEqual({ saved: true });
    expect(handler).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/fn/case-write/saveCase/", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", authorization: "Bearer user.jwt.token" },
      body: JSON.stringify({ data: { title: "Prípad" } }),
    });
  });

  it("surfaces the server error message", async () => {
    const fetchMock = vi.fn(async () => json(401, { ok: false, error: "Neprihlásený alebo neplatný token." }));
    await expect(
      callServerFnRemote("ai/getAiStatus", undefined, { fetch: fetchMock, getToken: async () => null }),
    ).rejects.toThrow("Neprihlásený alebo neplatný token.");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ data: null }));
  });

  it("fails on a non-JSON error response and on a missing id", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>502</html>", { status: 502 }));
    await expect(callServerFnRemote("ai/getAiStatus", {}, { fetch: fetchMock, getToken: async () => null })).rejects.toThrow(
      "Serverová funkcia zlyhala (HTTP 502).",
    );
    await expect(callServerFnRemote(undefined, {}, { fetch: fetchMock, getToken: async () => null })).rejects.toThrow(
      /identifikátor/,
    );
  });
});

describe("server function transport limits and packaged clients", () => {
  it("refuses an oversized body before sending it (clear error instead of a platform 413)", async () => {
    const fetchMock = vi.fn();
    await expect(
      callServerFnRemote("ai/runForensicAutopilot", { documentText: "č".repeat(600) }, {
        fetch: fetchMock,
        getToken: async () => "t",
        maxBodyBytes: 1000,
      }),
    ).rejects.toThrow(/príliš veľké/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls a configured server origin without cookies (Electron app://)", async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true, result: 1 }));
    await callServerFnRemote("profile/getMyProfile", undefined, {
      fetch: fetchMock,
      getToken: async () => "t",
      baseUrl: serverFnBaseUrl("https://pandora.example.org"),
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pandora.example.org/api/fn/profile/getMyProfile/");
    expect(init.credentials).toBe("omit");
  });

  it("accepts only an https origin without a path", () => {
    expect(serverFnBaseUrl(undefined)).toBe("");
    expect(serverFnBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => serverFnBaseUrl("http://pandora.example.org")).toThrow(/https/);
    expect(() => serverFnBaseUrl("https://pandora.example.org/api")).toThrow(/bez cesty/);
    expect(() => serverFnBaseUrl("nope")).toThrow(/platná URL/);
  });
});
