import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forza/access-audit", () => ({ getSupabaseSessionToken: async () => "token" }));

import { useVerifiedEvidence } from "@/hooks/useVerifiedEvidence";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}
const itemsResponse = (id: string) =>
  new Response(JSON.stringify({ items: [{ id, integrityStatus: "verified" }] }), { status: 200 });

describe("useVerifiedEvidence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ignores a late response of the previous case after a case switch", async () => {
    const slowA = deferred();
    const fetchMock = vi.fn((url: string) =>
      url.includes("caseId=case-a") ? slowA.promise : Promise.resolve(itemsResponse(B)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(({ caseId }) => useVerifiedEvidence(caseId), {
      initialProps: { caseId: "case-a" },
    });
    rerender({ caseId: "case-b" });
    await waitFor(() => expect([...result.current.knownEvidence]).toEqual([B]));

    await act(async () => {
      slowA.resolve(itemsResponse(A));
      await slowA.promise;
    });
    expect([...result.current.knownEvidence]).toEqual([B]);
    expect(result.current.loading).toBe(false);
  });

  it("fails closed when the ledger is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { result } = renderHook(() => useVerifiedEvidence("case-x"));
    await waitFor(() => expect(result.current.error).toMatch(/503/));
    expect(result.current.knownEvidence.size).toBe(0);
  });
});
