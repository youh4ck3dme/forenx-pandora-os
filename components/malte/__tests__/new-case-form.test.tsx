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

const mockRefresh = vi.fn(async () => {});

vi.mock("@/lib/hooks/useActiveCase", () => ({
  useActiveCase: () => ({
    setActiveCaseId: mockSetActiveCaseId,
    refresh: mockRefresh,
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

  describe("Regression: case creation flow", () => {
    it("navigates to /forza/prehlad?start=1 after success by default", async () => {
      mockCreateCase.mockResolvedValueOnce("new-case-id");

      const { getByPlaceholderText, getByRole } = render(<NewCaseForm />);
      fireEvent.change(getByPlaceholderText("Názov prípadu"), {
        target: { value: "Prípad Alfa" },
      });
      fireEvent.click(getByRole("button", { name: "Vytvoriť prípad" }));

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith("Prípad vytvorený.");
        expect(mockPush).toHaveBeenCalledWith("/forza/prehlad?start=1");
      });
    });

    it("rejects whitespace-only name and never calls createCase", async () => {
      const { getByPlaceholderText, getByRole } = render(<NewCaseForm />);
      fireEvent.change(getByPlaceholderText("Názov prípadu"), {
        target: { value: "   " },
      });
      fireEvent.click(getByRole("button", { name: "Vytvoriť prípad" }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Zadajte názov prípadu.");
      });
      expect(mockCreateCase).not.toHaveBeenCalled();
    });

    it("prevents a second submit while the first is in flight", async () => {
      let resolve!: (id: string) => void;
      mockCreateCase.mockReturnValueOnce(
        new Promise<string>((r) => { resolve = r; }),
      );

      const { getByPlaceholderText, getByRole } = render(<NewCaseForm goToHub={false} />);
      fireEvent.change(getByPlaceholderText("Názov prípadu"), {
        target: { value: "Prípad Beta" },
      });

      const btn = getByRole("button");
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);

      resolve("id-beta");
      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());

      expect(mockCreateCase).toHaveBeenCalledTimes(1);
    });

    it("shows error message with Skúsiť znova action on generic failure", async () => {
      mockCreateCase.mockRejectedValueOnce(new Error("Databáza nedostupná."));

      const { getByPlaceholderText, getByRole } = render(<NewCaseForm goToHub={false} />);
      fireEvent.change(getByPlaceholderText("Názov prípadu"), {
        target: { value: "Prípad Gama" },
      });
      fireEvent.click(getByRole("button", { name: "Vytvoriť prípad" }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Databáza nedostupná.",
          expect.objectContaining({
            action: expect.objectContaining({ label: "Skúsiť znova" }),
          }),
        );
      });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("sends hardcoded subtitle when withSubtitle is false", async () => {
      mockCreateCase.mockResolvedValueOnce("case-no-sub");

      const { getByPlaceholderText, getByRole } = render(
        <NewCaseForm withSubtitle={false} goToHub={false} />,
      );
      fireEvent.change(getByPlaceholderText("Názov prípadu"), {
        target: { value: "Prípad Delta" },
      });
      fireEvent.click(getByRole("button", { name: "Vytvoriť prípad" }));

      await waitFor(() => {
        expect(mockCreateCase).toHaveBeenCalledWith({
          name: "Prípad Delta",
          subtitle: "Šifrovaný priestor prípadu",
        });
      });
    });
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
      expect(mockPush).toHaveBeenCalledWith("/auth/login/");
    });
  });
});
