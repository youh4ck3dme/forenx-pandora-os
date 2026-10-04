import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  applyDocumentTheme,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../useCaseStore";

describe("Theme System & Amber Gold Palette Verification", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.documentElement;
    root.className = "";
    root.style.colorScheme = "";
    localStorage.clear();
  });

  afterEach(() => {
    root.className = "";
    root.style.colorScheme = "";
    localStorage.clear();
  });

  it("applies amber theme with both 'dark' and 'amber' classes and dark colorScheme", () => {
    applyDocumentTheme("amber");
    expect(root.classList.contains("amber")).toBe(true);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("removes 'amber' class when switching to 'light' theme", () => {
    applyDocumentTheme("amber");
    expect(root.classList.contains("amber")).toBe(true);

    applyDocumentTheme("light");
    expect(root.classList.contains("amber")).toBe(false);
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });

  it("removes 'amber' class when switching to standard 'dark' theme", () => {
    applyDocumentTheme("amber");
    expect(root.classList.contains("amber")).toBe(true);

    applyDocumentTheme("dark");
    expect(root.classList.contains("amber")).toBe(false);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("reads stored 'amber' theme from localStorage correctly", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "amber");
    expect(readStoredTheme()).toBe<ThemeMode>("amber");
  });

  it("handles 'system' preference theme application correctly", () => {
    // Mock matchMedia for dark mode
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    applyDocumentTheme("system");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("amber")).toBe(false);
    expect(root.style.colorScheme).toBe("dark");

    vi.unstubAllGlobals();
  });
});
