import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const route = vi.hoisted(() => ({ pathname: "/pricing" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

let GoogleAnalyticsConsent: typeof import("./google-analytics-consent").GoogleAnalyticsConsent;

describe("GoogleAnalyticsConsent", () => {
  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_ANALYTICS", "true");
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST123");
    ({ GoogleAnalyticsConsent } = await import("./google-analytics-consent"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.getElementById("forenx-google-analytics")?.remove();
    delete window.dataLayer;
    delete window.gtag;
  });

  it("does not load the analytics tag until consent is granted", async () => {
    render(<GoogleAnalyticsConsent />);

    await screen.findByRole("button", { name: "Odmietnuť" });
    expect(document.getElementById("forenx-google-analytics")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Odmietnuť" }));

    expect(document.getElementById("forenx-google-analytics")).toBeNull();
    expect(window.localStorage.getItem("forenx.analytics-consent.v1")).toBe(
      "rejected",
    );
  });

  it("loads GA4 after consent and reports only the allowlisted page path", async () => {
    render(<GoogleAnalyticsConsent />);

    fireEvent.click(await screen.findByRole("button", { name: "Povoliť analytiku" }));

    await waitFor(() => {
      expect(document.getElementById("forenx-google-analytics")).not.toBeNull();
    });

    const events = window.dataLayer ?? [];
    expect(events).toContainEqual([
      "event",
      "page_view",
      expect.objectContaining({
        page_path: "/pricing",
        page_location: `${window.location.origin}/pricing`,
        page_title: "ForenX",
      }),
    ]);
    expect(window.localStorage.getItem("forenx.analytics-consent.v1")).toBe(
      "accepted",
    );
  });

  it("does not send internal case routes to analytics", async () => {
    route.pathname = "/forza/case-123";
    render(<GoogleAnalyticsConsent />);

    fireEvent.click(await screen.findByRole("button", { name: "Povoliť analytiku" }));

    await waitFor(() => {
      expect(document.getElementById("forenx-google-analytics")).not.toBeNull();
    });

    expect(window.dataLayer).not.toContainEqual([
      "event",
      "page_view",
      expect.anything(),
    ]);
    expect(JSON.stringify(window.dataLayer)).not.toContain("case-123");
    route.pathname = "/pricing";
  });
});
