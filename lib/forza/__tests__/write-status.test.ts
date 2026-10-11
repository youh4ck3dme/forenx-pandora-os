import { describe, expect, it } from "vitest";
import { SERVER_WRITE_LABELS, deriveServerWriteState } from "@/lib/forza/write-status";

describe("server write states", () => {
  it("má štyri stavy so slovenskými popismi", () => {
    expect(SERVER_WRITE_LABELS).toEqual({
      pending: "Čaká na odoslanie",
      sending: "Odosiela sa",
      saved: "Uložené na serveri",
      failed: "Odoslanie zlyhalo",
    });
  });

  it("„Uložené na serveri“ iba po potvrdení servera", () => {
    expect(deriveServerWriteState({ isSaving: false, lastSavedAt: null, saveError: null })).toBe("pending");
    expect(deriveServerWriteState({ isSaving: true, lastSavedAt: "10:00", saveError: null })).toBe("sending");
    expect(deriveServerWriteState({ isSaving: false, lastSavedAt: "10:00", saveError: "x" })).toBe("failed");
    expect(deriveServerWriteState({ isSaving: false, lastSavedAt: "10:00", saveError: null })).toBe("saved");
  });
});
