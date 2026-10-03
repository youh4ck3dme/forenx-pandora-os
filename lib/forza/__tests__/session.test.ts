// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAuthCookies: vi.fn(),
  idbClear: vi.fn(),
}));

vi.mock("@/lib/auth/cookies", () => ({
  clearAuthCookies: mocks.clearAuthCookies,
}));

vi.mock("@/lib/forza/idb", () => ({
  idbClear: mocks.idbClear,
}));

vi.mock("@/lib/forza/dev-auth", () => ({
  clearDevFreeEntry: vi.fn(),
}));

import { clearClientState, signOutEverywhere } from "../session";

describe("lib/forza/session signOutEverywhere and clearClientState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.idbClear.mockResolvedValue(undefined);
  });

  it("clearClientState awaits clearAuthCookies and returns cookiesCleared status", async () => {
    mocks.clearAuthCookies.mockResolvedValueOnce(true);
    const result = await clearClientState();
    expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ cookiesCleared: true });
  });

  it("signOutEverywhere throws error if cookie clearing fails", async () => {
    mocks.clearAuthCookies.mockResolvedValueOnce(false);
    const fakeClient = {
      auth: {
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };

    await expect(signOutEverywhere(fakeClient)).rejects.toThrow(
      "Zlyhalo zmazanie autentifikačnej relácie zo servera.",
    );
    expect(fakeClient.auth.signOut).toHaveBeenCalledWith();
    expect(mocks.clearAuthCookies).toHaveBeenCalled();
  });

  it("signOutEverywhere succeeds when cookies are cleared", async () => {
    mocks.clearAuthCookies.mockResolvedValueOnce(true);
    const fakeClient = {
      auth: {
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };

    const res = await signOutEverywhere(fakeClient);
    expect(res).toEqual({ networkSignOut: true, cookiesCleared: true });
  });

  it("signOutEverywhere falls back to local signOut on network error and succeeds if cookies are cleared", async () => {
    mocks.clearAuthCookies.mockResolvedValueOnce(true);
    const fakeClient = {
      auth: {
        signOut: vi
          .fn()
          .mockRejectedValueOnce(new Error("Network offline"))
          .mockResolvedValueOnce({ error: null }),
      },
    };

    const res = await signOutEverywhere(fakeClient);
    expect(fakeClient.auth.signOut).toHaveBeenNthCalledWith(1);
    expect(fakeClient.auth.signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(res).toEqual({ networkSignOut: false, cookiesCleared: true });
  });
});
