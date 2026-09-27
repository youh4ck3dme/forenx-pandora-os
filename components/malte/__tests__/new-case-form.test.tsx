/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { NewCaseForm } from "../NewCaseForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    refetchQueries: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useActiveCase", () => ({
  useActiveCase: () => ({
    setActiveCaseId: vi.fn(),
  }),
}));

describe("NewCaseForm — Dark Theme & High Contrast Font", () => {
  it("uses dark background and text-white font for name and subtitle inputs", () => {
    const { getByPlaceholderText } = render(
      <NewCaseForm withSubtitle={true} />,
    );

    const nameInput = getByPlaceholderText("Názov prípadu");
    const descInput = getByPlaceholderText("Krátky popis (nepovinné)");

    // Kontrola: font nesmie byť čierny, musí byť explicitne biely pre tmavý režim Sandboxu
    expect(nameInput.className).toContain("text-white");
    expect(nameInput.className).toContain("bg-black/60");
    expect(nameInput.className).toContain("placeholder:text-neutral-400");
    expect(nameInput.className).not.toContain("bg-card");

    expect(descInput.className).toContain("text-white");
    expect(descInput.className).toContain("bg-black/60");
    expect(descInput.className).toContain("placeholder:text-neutral-400");
    expect(descInput.className).not.toContain("bg-card");
  });
});
