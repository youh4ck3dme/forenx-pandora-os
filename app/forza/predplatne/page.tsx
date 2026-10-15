"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ShieldCheck } from "lucide-react";

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
import { PLANS } from "@/config/billing";
import {
  BillingRequestError,
  confirmCheckout,
  createCheckoutSession,
  getSubscriptionState,
  setSubscriptionCancellation,
} from "@/lib/forza/payments.functions";

declare global {
  interface Window {
    SumUpCard?: {
      mount(options: {
        id: string;
        checkoutId: string;
        amount: string;
        currency: string;
        locale: string;
        onResponse: (type: string, body: unknown) => void;
      }): { unmount(): void };
    };
  }
}

const SUMUP_WIDGET_SCRIPT_ID = "sumup-payment-widget-script";

export default function PredplatnePage() {
  return <SubscriptionScreen />;
}

function SubscriptionScreen() {
  const queryClient = useQueryClient();
  const [paymentAction, setPaymentAction] = useState<"checkout" | "cancel" | null>(null);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [acceptedRecurringTerms, setAcceptedRecurringTerms] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [restartCheckout, setRestartCheckout] = useState(false);
  const confirmationInFlight = useRef(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["subscription"],
    queryFn: getSubscriptionState,
  });
  const billingAvailable = data?.configured === true;
  const hasPro = data?.tier === "pro";

  useEffect(() => {
    if (!checkoutId) return;
    let disposed = false;
    let widget: { unmount(): void } | undefined;

    const mountWidget = () => {
      if (disposed || !window.SumUpCard) return;
      try {
        widget = window.SumUpCard.mount({
          id: "sumup-card-widget",
          checkoutId,
          amount: "1.00",
          currency: "EUR",
          locale: "sk-SK",
          onResponse: async (type) => {
            if (type === "success" && !confirmationInFlight.current) {
              confirmationInFlight.current = true;
              try {
                await confirmCheckout(checkoutId);
                await queryClient.invalidateQueries({ queryKey: ["subscription"] });
                setCheckoutId(null);
                setAcceptedRecurringTerms(false);
                setWidgetError(null);
                setRestartCheckout(false);
                toast.success(data?.trialUsed
                  ? "Predplatné Pro je aktívne. Platba 99 € bola potvrdená."
                  : "14-dňová skúšobná verzia Pro je aktívna.");
              } catch (error) {
                const message = error instanceof Error
                  ? error.message
                  : "Overenie platby SumUpom sa nepodarilo.";
                setWidgetError(message);
                if (error instanceof BillingRequestError && error.status === 402) {
                  setRestartCheckout(true);
                  setWidgetError("Platba 99 € neprešla. Zrušte toto overenie a skúste znova s inou kartou.");
                }
              } finally {
                confirmationInFlight.current = false;
              }
            } else if (type === "error" || type === "fail") {
              setWidgetError("Overenie karty nebolo dokončené. Skúste to znova.");
            }
          },
        });
      } catch {
        setWidgetError("Platobný formulár SumUp sa nepodarilo načítať.");
      }
    };

    let script = document.getElementById(SUMUP_WIDGET_SCRIPT_ID) as HTMLScriptElement | null;
    const addScript = !script;
    if (!script) {
      script = document.createElement("script");
      script.id = SUMUP_WIDGET_SCRIPT_ID;
      script.src = "https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js";
      script.async = true;
      script.addEventListener("error", () => {
        if (!disposed) setWidgetError("Platobný formulár SumUp sa nepodarilo načítať.");
      }, { once: true });
      document.head.appendChild(script);
    }
    script.addEventListener("load", mountWidget);
    if (window.SumUpCard) mountWidget();

    return () => {
      disposed = true;
      script?.removeEventListener("load", mountWidget);
      widget?.unmount();
      if (addScript && script && !window.SumUpCard) script.remove();
    };
  }, [checkoutId, data?.trialUsed, queryClient]);

  async function openBillingFlow() {
    if (!billingAvailable) {
      toast.error("SumUp platby nie sú nakonfigurované.");
      return;
    }

    if (hasPro) {
      const cancel = !data?.cancelAtPeriodEnd;
      setPaymentAction("cancel");
      try {
        await setSubscriptionCancellation(cancel);
        await queryClient.invalidateQueries({ queryKey: ["subscription"] });
        toast.success(cancel ? "Predplatné sa skončí na konci obdobia." : "Automatické obnovenie je zapnuté.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Nastavenie predplatného sa nepodarilo zmeniť.");
      } finally {
        setPaymentAction(null);
      }
      return;
    }

    if (!acceptedRecurringTerms) {
      toast.error("Potvrďte podmienky opakovaného účtovania.");
      return;
    }

    setPaymentAction("checkout");
    setWidgetError(null);
    setRestartCheckout(false);
    try {
      const checkout = await createCheckoutSession(true);
      setCheckoutId(checkout.checkoutId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Overenie karty SumUp sa nepodarilo začať.");
    } finally {
      setPaymentAction(null);
    }
  }

  async function retryCheckoutConfirmation() {
    if (!checkoutId || confirmationInFlight.current) return;
    confirmationInFlight.current = true;
    setWidgetError(null);
    try {
      await confirmCheckout(checkoutId);
      await queryClient.invalidateQueries({ queryKey: ["subscription"] });
      setCheckoutId(null);
      setAcceptedRecurringTerms(false);
      setRestartCheckout(false);
      toast.success(data?.trialUsed
        ? "Predplatné Pro je aktívne. Platba 99 € bola potvrdená."
        : "14-dňová skúšobná verzia Pro je aktívna.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stav platby sa nepodarilo overiť.";
      setWidgetError(message);
      if (error instanceof BillingRequestError && error.status === 402) {
        setRestartCheckout(true);
        setWidgetError("Platba 99 € neprešla. Zrušte toto overenie a skúste znova s inou kartou.");
      }
    } finally {
      confirmationInFlight.current = false;
    }
  }

  return (
    <PhoneFrame>
      <AppHeader title="Predplatné a licencovanie" />
      <Screen>
        <PaymentTestModeBanner configured={data?.configured} sandboxMode={data?.sandboxMode} />

        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary">
                {isLoading ? "Načítavam plán" : data?.status === "trialing" ? "Skúšobná verzia" : "Aktuálny plán"}
              </p>
              <h2 className="text-base font-bold text-foreground">
                {isError ? "Stav predplatného sa nepodarilo načítať" : data?.tierLabel || "—"}
              </h2>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {data?.cancelAtPeriodEnd
              ? "Predplatné sa skončí na konci aktuálneho obdobia a ďalšia platba sa nestrhne."
              : data?.currentPeriodEnd
                ? `Ďalšie obnovenie: ${new Date(data.currentPeriodEnd).toLocaleDateString("sk-SK")}.`
                : data?.status === "past_due"
                  ? "Platbu sa nepodarilo dokončiť. Prístup k Pro je pozastavený."
                  : "Plán a jeho limity sa overujú podľa potvrdeného stavu predplatného."}
          </p>
          {data?.trialUsed && !hasPro && (
            <p className="text-xs text-muted-foreground">14-dňová skúšobná verzia už bola použitá.</p>
          )}
        </Card>

        <SectionTitle>Dostupné plány</SectionTitle>

        <div className="grid gap-3 sm:grid-cols-2">
          {Object.values(PLANS).map((plan) => (
            <Card key={plan.id} className="space-y-3 flex flex-col justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">{plan.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
                <p className="text-lg font-extrabold text-foreground mt-2">
                  {plan.amount ? `${plan.amount} € / mes.` : "Zadarmo"}
                </p>
                {plan.id === "pro" && !data?.trialUsed && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Prvých 14 dní bez mesačného poplatku. SumUp overí kartu autorizačnou platbou 1 € a okamžite ju refunduje. Po triale sa automaticky účtuje 99 € mesačne, kým predplatné nezrušíte.
                  </p>
                )}
                {plan.id === "pro" && data?.trialUsed && !hasPro && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Trial už bol použitý. SumUp overí kartu autorizačnou platbou 1 € a okamžite ju refunduje, potom sa strhne 99 € za prvý mesiac a ďalej 99 € mesačne, kým predplatné nezrušíte.
                  </p>
                )}
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {plan.id === "pro" && !hasPro && !checkoutId && (
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={acceptedRecurringTerms}
                    onChange={(event) => setAcceptedRecurringTerms(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {data?.trialUsed
                      ? "Súhlasím s uložením karty, okamžitým účtovaním 99 € za prvý mesiac po overení a následným účtovaním 99 € mesačne, ak predplatné nezruším."
                      : "Súhlasím s uložením karty pre opakované platby a s účtovaním 99 € mesačne po 14-dňovom triale, ak predplatné nezruším."}
                  </span>
                </label>
              )}
              {plan.id === "pro" && checkoutId && (
                <div className="space-y-2">
                  <div id="sumup-card-widget" className="min-h-16" />
                  {widgetError && <p role="alert" className="text-xs text-destructive">{widgetError}</p>}
                  {widgetError && !restartCheckout && (
                    <Button variant="outline" className="w-full" onClick={retryCheckoutConfirmation}>
                      Skontrolovať stav platby
                    </Button>
                  )}
                  <Button variant="outline" className="w-full" onClick={() => {
                    setCheckoutId(null);
                    setAcceptedRecurringTerms(false);
                    setWidgetError(null);
                    setRestartCheckout(false);
                  }}>
                    {restartCheckout ? "Zrušiť a skúsiť znova" : "Zrušiť overenie karty"}
                  </Button>
                </div>
              )}
              {!checkoutId && (
                <Button
                  variant={plan.id === "pro" ? "default" : "outline"}
                  className="w-full mt-4"
                  disabled={
                    plan.id === "free" ||
                    !billingAvailable ||
                    isLoading ||
                    paymentAction !== null ||
                    isError ||
                    (hasPro && !data?.currentPeriodEnd) ||
                    (!hasPro && !acceptedRecurringTerms)
                  }
                  onClick={openBillingFlow}
                >
                  {plan.id === "free"
                    ? (hasPro ? "Základný plán" : "Aktuálny plán")
                    : !billingAvailable
                      ? "SumUp nie je dostupný"
                      : paymentAction === "checkout"
                        ? "Pripravujem overenie…"
                        : paymentAction === "cancel"
                          ? "Ukladám zmenu…"
                          : hasPro
                            ? data?.cancelAtPeriodEnd ? "Obnoviť predplatné" : "Zrušiť predplatné"
                            : data?.trialUsed ? "Aktivovať Pro — 99 €" : "Začať 14-dňový trial"}
                </Button>
              )}
            </Card>
          ))}
        </div>
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
