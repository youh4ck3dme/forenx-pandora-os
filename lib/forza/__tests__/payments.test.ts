import { describe, expect, it } from "vitest";
import {
  createPortalSession,
  getSubscriptionState,
} from "../payments.functions";

describe("payment configuration", () => {
  it("fails closed when no payment provider is configured", async () => {
    await expect(getSubscriptionState()).resolves.toMatchObject({
      configured: false,
      status: "inactive",
      tier: "free",
    });
  });

  it("does not create a portal session without server-side billing", async () => {
    await expect(createPortalSession()).rejects.toThrow(
      "Platobný portál nie je nakonfigurovaný",
    );
  });
});
