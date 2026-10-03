import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FaviconService } from "@/lib/services/favicon-service";
import { reportClientError } from "@/components/forza/ObservabilityReporter";
import * as accessAudit from "@/lib/forza/access-audit";

describe("Focused Regression: Production Fixes", () => {
  describe("1. FaviconService URL Validation", () => {
    it("returns empty string for empty input, whitespace, or invalid protocol", () => {
      expect(FaviconService.getFaviconUrl("")).toBe("");
      expect(FaviconService.getFaviconUrl("   ")).toBe("");
      expect(FaviconService.getFaviconUrl("pandora://newtab")).toBe("");
      expect(FaviconService.getFaviconUrl("pandora://settings")).toBe("");
      expect(FaviconService.getFaviconUrl("newtab")).toBe("");
      expect(FaviconService.getFaviconUrl("about:blank")).toBe("");
      expect(FaviconService.getFaviconUrl("not-a-valid-url")).toBe("");
      expect(FaviconService.getFaviconUrl("javascript:void(0)")).toBe("");
    });

    it("returns empty string for localhost and local IP addresses", () => {
      expect(FaviconService.getFaviconUrl("http://localhost:3000")).toBe("");
      expect(FaviconService.getFaviconUrl("http://127.0.0.1:8000")).toBe("");
      expect(FaviconService.getFaviconUrl("https://192.168.1.1")).toBe("");
    });

    it("returns local /favicon.svg for internal and own pandora domains without external query", () => {
      expect(FaviconService.getFaviconUrl("https://pandora.whoiswho.at")).toBe("/favicon.svg");
      expect(FaviconService.getFaviconUrl("http://pandora.whoiswho.at/forza/")).toBe("/favicon.svg");
      expect(FaviconService.getFaviconUrl("https://auth.whoiswho.at")).toBe("/favicon.svg");
    });

    it("allows valid public http and https URLs", () => {
      const url1 = FaviconService.getFaviconUrl("https://example.com");
      expect(url1).toContain("https://www.google.com/s2/favicons?domain=example.com");

      const url2 = FaviconService.getFaviconUrl("http://github.com/path");
      expect(url2).toContain("https://www.google.com/s2/favicons?domain=github.com");
    });
  });

  describe("2. ObservabilityReporter Authentication Guard", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("does NOT call fetch when session token is missing (anonymous user)", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      vi.spyOn(accessAudit, "getSupabaseSessionToken").mockResolvedValue(null);

      reportClientError({ message: "Test unauthenticated error" });

      // Allow async IIFE tick
      await new Promise((r) => setTimeout(r, 20));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("calls fetch with Bearer token when session token is present", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      global.fetch = fetchMock;

      vi.spyOn(accessAudit, "getSupabaseSessionToken").mockResolvedValue("mock-jwt-token-12345");

      reportClientError({ message: "Test authenticated error" });

      // Allow async IIFE tick
      await new Promise((r) => setTimeout(r, 20));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/health/observe",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer mock-jwt-token-12345",
          }),
        }),
      );
    });
  });
});
