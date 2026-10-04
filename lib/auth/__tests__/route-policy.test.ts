import { describe, expect, it } from "vitest";
import {
  PUBLIC_ROUTES,
  isPublicRoutePattern,
  matchRoutePattern,
} from "@/lib/auth/route-policy";

describe("route-policy: matchRoutePattern", () => {
  it("matches exact paths and ignores a trailing slash", () => {
    expect(matchRoutePattern("/auth/login", "/auth/login")).toBe(true);
    expect(matchRoutePattern("/auth/login/", "/auth/login")).toBe(true);
    expect(matchRoutePattern("/auth/login", "/auth/login/")).toBe(true);
  });

  it("matches prefix patterns (/*) only on a path-segment boundary", () => {
    expect(matchRoutePattern("/api/healthz/deep", "/api/healthz/*")).toBe(true);
    expect(matchRoutePattern("/api/healthzz", "/api/healthz/*")).toBe(false);
    expect(matchRoutePattern("/api/healthz-evil", "/api/healthz/*")).toBe(false);
  });

  it("matches catch-all patterns only under the parent segment", () => {
    expect(matchRoutePattern("/blog/a/b", "/blog/[...slug]")).toBe(true);
    expect(matchRoutePattern("/blogger", "/blog/[...slug]")).toBe(false);
  });

  it("keeps root '/' exact (does not become a wildcard)", () => {
    expect(matchRoutePattern("/", "/")).toBe(true);
    expect(matchRoutePattern("/forza", "/")).toBe(false);
  });
});

describe("route-policy: isPublicRoutePattern (fail-closed)", () => {
  it.each([
    "/",
    "/auth/login",
    "/auth/register/",
    "/blog/some-post",
    "/api/healthz",
    "/api/health/public",
    "/api/auth/session",
    "/api/auth/webauthn/challenge",
    "/api/auth/webauthn/verify/",
    "/api/csp-report",
  ])("allows intentionally public route %s", (p) => {
    expect(isPublicRoutePattern(p)).toBe(true);
  });

  it.each([
    "/forza/prehlad",
    "/forza/pripady",
    "/browser",
    "/api/evidence/upload",
    "/api/forenzx/analysis",
    "/api/auth/webauthn/register/options",
    "/api/auth/session/evil",
    "/authx",
    "/auth/../forza/prehlad",
    "//evil.example.com",
    "",
  ])("rejects non-public route %j", (p) => {
    expect(isPublicRoutePattern(p)).toBe(false);
  });

  it("does not expose any private-looking prefix as public", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route).not.toMatch(/forza|browser|evidence|forenzx|admin/i);
    }
  });
});
