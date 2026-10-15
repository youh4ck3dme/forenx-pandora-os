import { supabase } from "@/integrations/supabase/client";

export type SubscriptionState = {
  configured: boolean;
  status: string;
  tier: string;
  tierLabel: string;
  features: string[];
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
  sandboxMode?: boolean;
  trialUsed?: boolean;
};

export class BillingRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BillingRequestError";
  }
}

export async function getSubscriptionState(): Promise<SubscriptionState> {
  return billingRequest<SubscriptionState>("/api/billing/subscription", "GET");
}

export async function createCheckoutSession(recurringConsent: boolean): Promise<{ checkoutId: string; amount: number }> {
  return billingRequest<{ checkoutId: string; amount: number }>("/api/billing/checkout", "POST", { recurringConsent });
}

export async function confirmCheckout(checkoutId: string): Promise<{
  status: string;
  currentPeriodEnd: string;
}> {
  return billingRequest("/api/billing/confirm", "POST", { checkoutId });
}

export async function setSubscriptionCancellation(cancel: boolean): Promise<{
  cancelAtPeriodEnd: boolean;
  status: string;
  currentPeriodEnd?: string;
}> {
  return billingRequest("/api/billing/cancel", "POST", { cancel });
}

async function billingRequest<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error("Prihláste sa do účtu, aby ste mohli spravovať predplatné.");
  }

  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    cache: "no-store",
  });

  const result = await response.json().catch(() => null) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !result) {
    throw new BillingRequestError(response.status, result?.error || "Predplatné sa nepodarilo načítať.");
  }
  return result;
}
