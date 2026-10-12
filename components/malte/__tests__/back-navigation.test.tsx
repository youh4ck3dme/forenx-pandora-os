/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACK_FALLBACK_ROUTE,
  PARENT_ROUTE,
  isSafeInternalPath,
  resolveBackTarget,
} from "@/components/malte/back-navigation";

const nav = vi.hoisted(() => ({ pathname: "/forza/zbrane/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("resolveBackTarget", () => {
  it("1. explicitný backHref má prednosť", () => {
    expect(
      resolveBackTarget({ pathname: "/forza/zbrane/", backHref: "/forza/pripady" }),
    ).toEqual({ kind: "href", href: "/forza/pripady", source: "explicit" });
  });

  it("2. známy nadradený route (aj s trailing slash a query)", () => {
    expect(resolveBackTarget({ pathname: "/forza/mcp-info/?x=1" })).toEqual({
      kind: "href",
      href: PARENT_ROUTE["/forza/mcp-info"],
      source: "parent",
    });
  });

  it("3. história iba pri same-origin referreri", () => {
    expect(
      resolveBackTarget({
        pathname: "/forza/neznama",
        referrer: "https://app.example/forza/pripady/",
        origin: "https://app.example",
        historyLength: 3,
      }),
    ).toEqual({ kind: "history" });
  });

  it("4. cudzí referrer alebo prázdna história → interný fallback", () => {
    const fallback = { kind: "href", href: BACK_FALLBACK_ROUTE, source: "fallback" };
    expect(
      resolveBackTarget({
        pathname: "/forza/neznama",
        referrer: "https://evil.example/",
        origin: "https://app.example",
        historyLength: 5,
      }),
    ).toEqual(fallback);
    expect(
      resolveBackTarget({
        pathname: "/forza/neznama",
        referrer: "https://app.example/x",
        origin: "https://app.example",
        historyLength: 1,
      }),
    ).toEqual(fallback);
    expect(resolveBackTarget({ pathname: "/forza/neznama" })).toEqual(fallback);
  });

  it("nebezpečný backHref sa ignoruje", () => {
    for (const bad of ["//evil.example", "https://evil.example", "javascript:alert(1)", "/\\evil"]) {
      expect(isSafeInternalPath(bad)).toBe(false);
      expect(resolveBackTarget({ pathname: "/forza/neznama", backHref: bad })).toMatchObject({
        source: "fallback",
      });
    }
  });
});

describe("BackButton", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("pre známu obrazovku renderuje odkaz na rodiča s a11y atribútmi a 44×44 cieľom", async () => {
    nav.pathname = "/forza/zbrane/";
    const { BackButton } = await import("@/components/malte/Shell");
    await act(async () => root.render(<BackButton />));
    const link = host.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/forza/viac");
    expect(link.getAttribute("aria-label")).toBe("Späť");
    expect(link.className).toMatch(/\bh-11\b/);
    expect(link.className).toMatch(/\bw-11\b/);
    expect(link.className).toMatch(/focus-visible:ring-2/);
  });

  it("pre neznámu obrazovku bez histórie nevolá history.back, ale ide na fallback", async () => {
    nav.pathname = "/forza/neznama/";
    const { BackButton } = await import("@/components/malte/Shell");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, origin: originalLocation.origin, assign },
    });
    try {
      await act(async () => root.render(<BackButton />));
      const button = host.querySelector("button")!;
      expect(button.getAttribute("aria-label")).toBe("Späť");
      expect(button.className).toMatch(/\bh-11\b/);
      await act(async () => button.click());
      expect(back).not.toHaveBeenCalled();
      expect(assign).toHaveBeenCalledWith(BACK_FALLBACK_ROUTE);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
      back.mockRestore();
    }
  });
});
