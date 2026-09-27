import { PLANS } from "@/config/billing";

export type SubscriptionState = {
  configured: boolean;
  status: string;
  tier: string;
  tierLabel: string;
  features: string[];
};

export async function getSubscriptionState(): Promise<SubscriptionState> {
  return {
    configured: false,
    status: "inactive",
    tier: "free",
    tierLabel: PLANS.free.name,
    features: PLANS.free.features,
  };
}

export async function createPortalSession(): Promise<{ url: string }> {
  throw new Error(
    "Platobný portál nie je nakonfigurovaný. Prémiový prístup nemožno aktivovať.",
  );
}
