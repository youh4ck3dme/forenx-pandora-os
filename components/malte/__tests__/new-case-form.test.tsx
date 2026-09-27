/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NewCaseForm } from "../NewCaseForm";
import { SessionExpiredError } from "@/lib/forza/session-expired";

const mockPush = vi.fn();
const mockRefetch = vi.fn();
const mockInvalidate = vi.fn();
const mockSetActiveCaseId = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
const mockCreateCase = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    refetchQueries: mockRefetch,
    invalidateQueries: mockInvalidate,
  }),
}));

vi.mock("@/lib/hooks/useActiveCase", () => ({
  useActiveCase: () => ({
    setActiveCaseId: mockSetActiveCaseId,
  }),
}));

vi.mock("@/lib/forza/case-data", () => ({
  createCase: (...args: any[]) => mockCreateCase(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: any[]) => mockToastError(...args),
    success: (...args: any[]) => mockToastSuccess(...args),
  },
}));

describe("NewCaseForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Dark Theme & High Contrast Font", () => {
    it("uses dark background and text-white font for name and subtitle inputs", () => {
      const { getByPlaceholderText } = render(
        <NewCaseForm withSubtitle={true} />,
      );

      const nameInput = getByPlaceholderText("Názov prípadu");
      const descInput = getByPlaceholderText("Krátky popis (nepovinné)");

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

  describe("Creation and Error Handling", () => {
    it("creates case successfully and stays on page when goToHub is false", async () => {
      mockCreateCase.mockResolvedValueOnce("test-case-id-123");
      const onCreated = vi.fn();

      const { getByPlaceholderText, getByRole } = render(
        <NewCaseForm goToHub={false} onCreated={onCreated} />,
      );

      const nameInput = getByPlaceholderText("Názov prípadu");
      fireEvent.change(nameInput, { target: { value: "Operácia Kladivo" } });

      const submitButton = getByRole("button", { name: "Vytvoriť prípad" });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateCase).toHaveBeenCalledWith({
          name: "Operácia Kladivo",
          subtitle: "",
        });
        expect(mockSetActiveCaseId).toHaveBeenCalledWith("test-case-id-123");
        expect(onCreated).toHaveBeenCalledWith("test-case-id-123");
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockToastSuccess).toHaveBeenCalledWith("Prípad vytvorený.");
      });
    });

    it("displays direct login action toast when SessionExpiredError occurs", async () => {
      mockCreateCase.mockRejectedValueOnce(new SessionExpiredError());

      const { getByPlaceholderText, getByRole } = render(
        <NewCaseForm />,
      );

      const nameInput = getByPlaceholderText("Názov prípadu");
      fireEvent.change(nameInput, { target: { value: "Operácia Kladivo" } });

      const submitButton = getByRole("button", { name: "Vytvoriť prípad" });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Relácia vypršala. Prihláste sa znova.",
          expect.objectContaining({
            action: expect.objectContaining({
              label: "Prihlásiť sa",
            }),
          }),
        );
      });

      // Execute login action
      const toastCall = mockToastError.mock.calls[0];
      const action = toastCall[1]?.action;
      action?.onClick();
      expect(mockPush).toHaveBeenCalledWith("/auth/login");
    });
  });
});
