/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/_authenticated/sandbox";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  apply: vi.fn(),
  task: vi.fn(),
  autopilot: vi.fn(),
  refresh: vi.fn(),
  consent: vi.fn(),
  toast: vi.fn(),
  active: {
    id: "regression-case",
    name: "Fixture",
    entities: [{}],
    transactions: [{}],
    events: [],
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useSearch: () => ({}),
  }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/hooks/useActiveCase", () => ({
  useActiveCase: () => ({
    activeCase: mocks.active,
    analysis: { alerts: [] },
    hasCase: true,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
  OFFLINE_AI_MESSAGE: "offline",
}));
vi.mock("@/hooks/useAiConsent", () => ({
  useAiConsent: () => ({ ensureConsent: mocks.consent, consentDialog: null }),
}));
vi.mock("@/lib/ai.functions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    parseUploadedCaseDocument: mocks.parse,
    runAiTask: mocks.task,
    runForensicAutopilot: mocks.autopilot,
  };
});
vi.mock("@/lib/case-graph.functions", () => ({
  applyAiResultsToCase: mocks.apply,
}));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.toast,
    error: mocks.toast,
    warning: mocks.toast,
    info: mocks.toast,
    message: mocks.toast,
  },
}));
vi.mock("@/components/malte/NewCaseForm", () => ({ NewCaseForm: () => null }));
vi.mock("@/components/malte/ProcessingOverlay", () => ({
  ProcessingOverlay: () => null,
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
const Sandbox = Route.options.component!;
let root: Root;
let host: HTMLDivElement;
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function upload() {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [
      new File(
        ["Fiktívny dokument na regresný test extrakcie."],
        "fixture.txt",
        { type: "text/plain" },
      ),
    ],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
}
describe("Sandbox regression: extraction → explicit apply → checks", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Network forbidden");
      }),
    );
    mocks.consent.mockResolvedValue("fixture-consent");
    mocks.parse.mockResolvedValue({
      fileName: "fixture.txt",
      rawText: "Fiktívny dokument na regresný test extrakcie.",
      charCount: 45,
      usedOcr: false,
      entities: {
        persons: [{ name: "Test Osoba", role: "svedok" }],
        companies: ["Test Firma"],
      },
    });
    mocks.apply.mockResolvedValue({ entities: 2, events: 0, relations: 0 });
    mocks.task.mockResolvedValue({
      status: "ok",
      output: { summary: "Kontrola fixture" },
    });
    mocks.refresh.mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Sandbox />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("extracts entities and only applies them after explicit action, with an Autopilot link", async () => {
    await upload();
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.apply).not.toHaveBeenCalled();
    await click("Spustiť AI analýzu");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.apply).toHaveBeenCalledWith({
      data: {
        caseId: "regression-case",
        persons: [{ name: "Test Osoba", role: "svedok" }],
        companies: ["Test Firma"],
        timeline: [],
      },
    });
    expect(mocks.refresh).toHaveBeenCalledWith("regression-case");
    expect(host.querySelector('a[href="/asistent"]')).not.toBeNull();
    expect(mocks.autopilot).not.toHaveBeenCalled();
  });

  it("runs the four controls in order without full Autopilot", async () => {
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Otvoriť kontroly AI"]',
        )!
        .click(),
    );
    await click("Spustiť v poradí");
    expect(mocks.task.mock.calls.map(([args]) => args.data.task)).toEqual([
      "case_summary",
      "normalize_descriptions",
      "admiss_audit",
      "alt_devil",
    ]);
    expect(mocks.autopilot).not.toHaveBeenCalled();
  });

  it("does not extract without consent", async () => {
    mocks.consent.mockResolvedValue(null);
    await upload();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("shows extraction failure and never applies missing results", async () => {
    mocks.parse.mockRejectedValue(new Error("OCR fixture failure"));
    await upload();
    expect(host.textContent).toContain("OCR fixture failure");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.autopilot).not.toHaveBeenCalled();
  });
});
