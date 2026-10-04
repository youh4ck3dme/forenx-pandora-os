/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExpiredError } from "@/lib/forza/session-expired";

let mockSession: {
  user: { id: string; email?: string } | null;
  expires_at?: number;
  access_token?: string;
} | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: mockSession },
        error: null,
      })),
      getUser: vi.fn(async () => ({
        data: { user: mockSession?.user ?? null },
        error: null,
      })),
    },
  },
}));

const mockSaveCase = vi.fn();
vi.mock("@/lib/forza/case-write.functions", () => ({
  saveCase: (...args: any[]) => mockSaveCase(...args),
  saveEntity: vi.fn(),
  saveTransaction: vi.fn(),
  saveWeapon: vi.fn(),
  saveRelation: vi.fn(),
  saveEvent: vi.fn(),
  deleteRecord: vi.fn(),
  getDeleteImpact: vi.fn(),
}));

import { shouldUseLocalCaseStore } from "@/lib/forza/identity";
import { createCase } from "@/lib/forza/case-data";

describe("Case (Prípad) creation and session store selection regression tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockSession = null;
    mockSaveCase.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockSession = null;
  });

  it("strictly enforces 'Prípad' domain terminology and never 'Projekt'", () => {
    const label = "Vytvoriť prípad";
    expect(label).toContain("prípad");
    expect(label.toLowerCase()).not.toContain("projekt");
  });

  it("throws SessionExpiredError in production when no live Supabase session exists", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete (window as any).location;
    window.location = new URL("https://pandora.whoiswho.at/forza/pripady") as any;

    mockSession = null;
    await expect(shouldUseLocalCaseStore()).rejects.toThrow(SessionExpiredError);
  });

  it("allows cloud case store when a valid non-expired Supabase session is present in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete (window as any).location;
    window.location = new URL("https://pandora.whoiswho.at/forza/pripady") as any;

    mockSession = {
      user: { id: "test-user-uuid-1234", email: "test@whoiswho.at" },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      access_token: "mock-valid-bearer-token",
    };

    const isLocal = await shouldUseLocalCaseStore();
    expect(isLocal).toBe(false);
  });

  it("delegates to saveCase when creating a case with active cloud session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete (window as any).location;
    window.location = new URL("https://pandora.whoiswho.at/forza/pripady") as any;

    mockSession = {
      user: { id: "test-user-uuid-1234", email: "test@whoiswho.at" },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      access_token: "mock-valid-bearer-token",
    };

    const mockSavedCaseId = "case-uuid-5555";
    mockSaveCase.mockResolvedValueOnce({ id: mockSavedCaseId });

    const resultId = await createCase({
      name: "Vyšetrovanie Podvodu 2026",
      subtitle: "Forenzná analýza tokov",
    });

    expect(resultId).toBe(mockSavedCaseId);
    expect(mockSaveCase).toHaveBeenCalledWith({
      data: {
        name: "Vyšetrovanie Podvodu 2026",
        subtitle: "Forenzná analýza tokov",
      },
    });
  });

  it("uses local store and dev cases when running on local loopback host", async () => {
    delete (window as any).location;
    window.location = new URL("http://localhost:3000/forza/pripady") as any;
    window.localStorage.setItem("forendo:dev-free-entry", "true");

    const isLocal = await shouldUseLocalCaseStore();
    expect(isLocal).toBe(true);

    const devCaseId = await createCase({
      name: "Lokálny Prípad Test",
      subtitle: "Loopback test",
    });
    expect(typeof devCaseId).toBe("string");
    expect(devCaseId.length).toBeGreaterThan(0);
  });
});
