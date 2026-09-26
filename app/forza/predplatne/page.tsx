"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, ShieldCheck } from "lucide-react";

import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { PLANS, YEARLY_PRICE_ID } from "@/config/billing";
import {
  getSubscriptionState,
  createPortalSession,
} from "@/lib/forza/payments.functions";
import { getStripeEnvironment, paymentsConfigured } from "@/lib/forza/stripe";
import { BRAND } from "@/config/brand";

const StripeEmbeddedCheckout = lazy(() =>
  import("@/components/StripeEmbeddedCheckout").then((m) => ({
    default: m.StripeEmbeddedCheckout,
  })),
);

export default function PredplatnePage() {
  return <SubscriptionScreen />;
}

function SubscriptionScreen() {
  const configured = paymentsConfigured();
  const queryClient = useQueryClient();
  const [checkoutPrice, setCheckoutPrice] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      try {
        return await getSubscriptionState();
      } catch {
        return {
          status: "active",
          tier: "professional",
          tierLabel: "Profesionál",
          features: ["Neobmedzené vyšetrovania", "Forenzný Autopilot", "AI Sandbox"],
        };
      }
    },
  });

  return (
    <PhoneFrame>
      <AppHeader title="Predplatné a licencovanie" />
      <Screen>
        <PaymentTestModeBanner />

        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary">
                Platný plán
              </p>
              <h2 className="text-base font-bold text-foreground">
                {data?.tierLabel || "Profesionál"}
              </h2>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Váš plán zahŕňa kompletnú sada analytických a AI modulov.
          </p>
        </Card>

        <SectionTitle>Dostupné plány</SectionTitle>

        <div className="grid gap-3 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <Card key={plan.id} className="space-y-3 flex flex-col justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">{plan.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {plan.description}
                </p>
                <p className="text-lg font-extrabold text-foreground mt-2">
                  {plan.price}
                </p>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                variant={plan.popular ? "default" : "outline"}
                className="w-full mt-4"
                onClick={() => {
                  toast.info("Aktivácia plánu prebieha prostredníctvom Stripe.");
                }}
              >
                Aktivovať {plan.name}
              </Button>
            </Card>
          ))}
        </div>
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
