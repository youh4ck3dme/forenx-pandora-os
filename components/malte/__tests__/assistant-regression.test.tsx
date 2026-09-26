/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { regressionDossier } from "@/test-fixtures/autopilot";
import { Assistant } from "@/components/malte/Assistant";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  run: vi.fn(),
  extract: vi.fn(),
  consent: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  pdf: vi.fn(),
  status: {
    data: { configured: true, chatConfigured: true, analysisConfigured: true },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  online: true,
  active: { id: "regression-case", transactions: [] },
}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mocks.status,
}));
vi.mock("@/hooks/useActiveCase", () => ({
  useActiveCase: () => ({
    activeCase: mocks.active,
    analysis: { alerts: [] },
    hasCase: true,
    revisions: {},
    setDossier: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mocks.online,
  OFFLINE_AI_MESSAGE: "offline",
}));
vi.mock("@/hooks/useAiConsent", () => ({
  useAiConsent: () => ({ ensureConsent: mocks.consent, consentDialog: null }),
}));
vi.mock("@/lib/ai.functions", () => ({
  getForensicDossier: mocks.load,
  saveCaseDossier: mocks.save,
  runForensicAutopilot: mocks.run,
  extractBulkFilesText: mocks.extract,
  MIN_EXTRACT_CHARS: 30,
  getAiStatus: vi.fn(),
  previewAiPayload: vi.fn(),
  runAiTask: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
    warning: mocks.warning,
    info: mocks.info,
  },
}));
vi.mock("@/lib/export-pdf", () => ({ exportDossierToPDF: mocks.pdf }));
vi.mock("@/lib/case-data", () => ({ upsertTransaction: vi.fn() }));
vi.mock("@/components/malte/LawyerTourGuide", () => ({
  LawyerTourGuide: () => null,
}));
vi.mock("@/components/malte/TruthTimestorySection", () => ({
  TruthTimestorySection: () => null,
}));
vi.mock("@/components/malte/Shell", () => {
  const Container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AppHeader: Container,
    BottomNav: () => null,
    Card: Container,
    PhoneFrame: Container,
    Screen: Container,
    SectionTitle: Container,
  };
});

let root: Root;
let host: HTMLDivElement;
async function render() {
  await act(async () => root.render(<Assistant />));
}
function button(text: string) {
  const found = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(found, "Button: " + text).toBeDefined();
  return found!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function uploadAndRun() {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input).not.toBeNull();
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [
      new File(["Fiktívny text dokumentu. ".repeat(5)], "fixture.txt", {
        type: "text/plain",
      }),
    ],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  await click(
    mocks.online ? "Spustiť forenznú analýzu" : "AI vyžaduje internet",
  );
}

describe("Assistant regression: rendered UI with mocked server boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Network forbidden");
      }),
    );
    mocks.status.isError = false;
    mocks.status.isPending = false;
    mocks.status.data = {
      configured: true,
      chatConfigured: true,
      analysisConfigured: true,
    };
    mocks.online = true;
    mocks.active.id = "regression-case";
    mocks.load.mockResolvedValue({ success: true, dossier: null });
    mocks.save.mockResolvedValue({ success: true });
    mocks.consent.mockResolvedValue("fixture-consent");
    mocks.extract.mockResolvedValue({
      success: true,
      aggregatedText: "Zápisnica. ".repeat(20),
      totalCharCount: 220,
      totalFiles: 1,
      successfulFiles: 1,
      results: [
        {
          fileName: "fixture.txt",
          success: true,
          charCount: 220,
          usedOcr: false,
        },
      ],
    });
    mocks.run.mockResolvedValue({
      success: true,
      dossier: regressionDossier(),
      saveStatus: "saved",
      warnings: [],
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  it("shows status lookup failure rather than missing key, and allows refresh", async () => {
    mocks.status.isError = true;
    await render();
    expect(host.textContent).toContain("nepodarilo zistiť");
    expect(host.textContent).not.toContain("chýba serverový");
    await click("Obnoviť stav AI");
    expect(mocks.status.refetch).toHaveBeenCalled();
    await uploadAndRun();
    expect(mocks.consent).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("blocks analysis when only chat is configured", async () => {
    mocks.status.data.analysisConfigured = false;
    await render();
    await uploadAndRun();
    expect(button("Spustiť forenznú analýzu").disabled).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("allows analysis when only analysis is configured", async () => {
    mocks.status.data.configured = false;
    mocks.status.data.chatConfigured = false;
    await render();
    await uploadAndRun();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("blocks quick tasks without inputs", async () => {
    await render();
    await click("Rýchle triážne úlohy");
    expect(button("Spustiť úlohu").disabled).toBe(true);
    expect(host.textContent).toContain("Prípad zatiaľ");
  });
  it.each(["loading", "offline"])("blocks analysis while %s", async (mode) => {
    mocks.status.isPending = mode === "loading";
    mocks.online = mode !== "offline";
    await render();
    await uploadAndRun();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("blocks repeated clicks while consent is pending", async () => {
    let resolve!: (value: string | null) => void;
    mocks.consent.mockImplementation(
      () =>
        new Promise<string | null>((r) => {
          resolve = r;
        }),
    );
    await render();
    await uploadAndRun();
    await click("Rýchle triážne úlohy");
    expect(button("Spustiť úlohu").disabled).toBe(true);
    await click("Spustiť úlohu");
    expect(mocks.consent).toHaveBeenCalledTimes(1);
    await act(async () => resolve(null));
    expect(mocks.run).not.toHaveBeenCalled();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders persisted partial/truncation warnings after reload", async () => {
    const dossier = regressionDossier();
    dossier.analysisMeta!.analysisStatus = "partial";
    dossier.analysisMeta!.truncation.truncated = true;
    mocks.load.mockResolvedValue({ success: true, dossier });
    await render();
    expect(host.textContent).toMatch(/skrátený alebo rozdelený/);
    expect(host.textContent).toMatch(/čiastočn/i);
    expect(host.textContent).toContain("fixture-model");
  });

  it("shows auto-save success after upload", async () => {
    await render();
    await uploadAndRun();
    expect(mocks.run).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId: "regression-case",
        documentIds: ["fixture.txt"],
      }),
    });
    expect(mocks.success).toHaveBeenCalledWith(
      "Forenzná analýza dokončená a uložená do prípadu.",
    );
    expect(button("Uložené").textContent).toMatch(/Uložené/);
  });

  it("shows save failure and Retry saves the same dossier without repeating AI", async () => {
    const dossier = regressionDossier();
    mocks.run.mockResolvedValue({
      success: true,
      dossier,
      saveStatus: "failed",
      saveError: "Database unavailable",
      warnings: ["Výsledok je čiastočný."],
    });
    await render();
    await uploadAndRun();
    expect(host.textContent).toContain("Database unavailable");
    expect(host.textContent).toContain("Výsledok je čiastočný.");
    await click("Retry uloženia");
    expect(mocks.save).toHaveBeenCalledWith({
      data: { caseId: "regression-case", dossier },
    });
    expect(host.textContent).not.toContain("Database unavailable");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("keeps Retry available after a failed manual save", async () => {
    mocks.load.mockResolvedValue({
      success: true,
      dossier: regressionDossier(),
    });
    mocks.save.mockRejectedValueOnce(new Error("Save failed"));
    await render();
    await click("Uložiť do prípadu");
    expect(host.textContent).toContain("Save failed");
    expect(button("Retry uloženia").disabled).toBe(false);
  });

  it("blocks demo saving and exports the demo with its marker", async () => {
    await render();
    await click("Načítať syntetickú ukážku");
    expect(button("Uložiť do prípadu").disabled).toBe(true);
    await click("Uložiť do prípadu");
    expect(mocks.save).not.toHaveBeenCalled();
    await click("(PDF)");
    expect(mocks.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisMeta: expect.objectContaining({
          isDemo: true,
          analysisStatus: "demo",
        }),
      }),
    );
  });

  it("does not load a persisted demo into a real case", async () => {
    const dossier = regressionDossier();
    dossier.analysisMeta!.isDemo = true;
    mocks.load.mockResolvedValue({ success: true, dossier });
    await render();
    expect(host.textContent).not.toContain("Regresný test");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not extract or call AI without consent", async () => {
    mocks.consent.mockResolvedValue(null);
    await render();
    await uploadAndRun();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
