/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks/useActiveCase", () => ({
  useActiveCase: () => ({ activeCaseId: "11111111-1111-4111-8111-111111111111" }),
}));
vi.mock("@/lib/forza/access-audit", () => ({
  getSupabaseSessionToken: vi.fn(async () => "token"),
}));

const SHA = "ab".repeat(32);
function item(id: string, integrityStatus: string, verificationStatus?: string) {
  return {
    id,
    caseId: "11111111-1111-4111-8111-111111111111",
    fileName: `${id}.pdf`,
    fileSizeBytes: 10,
    mimeType: "application/pdf",
    sha256Hash: SHA,
    s3StorageKey: `cases/x/evidence/${id}`,
    s3Bucket: "b",
    uploadedAt: "2026-10-11T10:00:00.000Z",
    uploadedBy: "u",
    integrityStatus,
    ...(verificationStatus ? { verificationStatus } : {}),
    aiAnalyzed: false,
    tags: ["zmluva"],
  };
}

describe("EvidenceVaultPanel — stavy overenia", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            items: [
              item("pending", "checking", "pending"),
              item("failed", "checking", "error"),
              item("mismatch", "compromised", "mismatch"),
              item("ok", "verified", "verified"),
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("zobrazuje stav podľa servera, nie natvrdo „INTEGRITA OVERENÁ“", async () => {
    const { EvidenceVaultPanel } = await import("../evidence-vault-panel");
    await act(async () => root.render(<EvidenceVaultPanel />));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const badges = [...host.querySelectorAll<HTMLElement>("[data-testid='evidence-status']")];
    expect(badges.map((b) => b.dataset.state)).toEqual([
      "awaiting_verification",
      "verification_failed",
      "unverified",
      "verified",
    ]);
    expect(badges.map((b) => b.querySelector("summary")?.textContent?.trim())).toEqual([
      "Čaká na overenie",
      "Overenie zlyhalo",
      "Neoverené",
      "Overené",
    ]);
    expect(host.textContent).not.toContain("INTEGRITA OVERENÁ");
    // Technický detail je iba v rozbaľovacom zobrazení.
    expect(badges[1]?.tagName).toBe("DETAILS");
    expect(badges[1]?.textContent).toContain("ledger=error");
    const copy = host.querySelector("button[aria-label='Kopírovať SHA-256 hash']");
    expect(copy).not.toBeNull();
  });

  it("zdroj panelu už neobsahuje falošnú hlášku o overení po uploade", () => {
    const source = readFileSync(path.resolve(__dirname, "../evidence-vault-panel.tsx"), "utf8");
    expect(source).not.toContain("Dôkaz úspešne zaistený v S3 a overený");
    expect(source).not.toContain("INTEGRITA OVERENÁ");
  });
});
