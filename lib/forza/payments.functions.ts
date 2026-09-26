// Stub: payments module adapted for Next.js (Stripe not yet configured)

export type SubscriptionState = {
  configured: boolean;
  status: string;
  tier: string;
  tierLabel: string;
  features: string[];
};

/** Stub — returns a default professional plan while Stripe is not configured */
export async function getSubscriptionState(): Promise<SubscriptionState> {
  return {
    configured: false,
    status: "active",
    tier: "professional",
    tierLabel: "Profesionál",
    features: ["Neobmedzené vyšetrovania", "Forenzný Autopilot", "AI Sandbox"],
  };
}

/** Stub — portal session */
export async function createPortalSession(): Promise<{ url: string }> {
  return { url: "#" };
}
