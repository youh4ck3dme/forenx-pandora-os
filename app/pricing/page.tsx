import type { Metadata } from "next";
import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";
import { BRAND } from "@/config/brand";
import { PLANS } from "@/config/billing";

export const metadata: Metadata = {
  title: "Cenník ForenX",
  description:
    "Prehľad plánov ForenX pre analýzu finančných tokov, správu prípadov a forenzné reporty.",
};

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#07171c] text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-lg font-black tracking-wide">
          {BRAND.name}
        </Link>
        <Link
          href="/auth/login"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/35 hover:text-white"
        >
          Prihlásiť sa
        </Link>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-12 pt-10 text-center sm:pt-16">
        <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-1 text-xs text-emerald-200">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          AI výstup nie je dôkaz
        </p>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
          Forenzná práca s jasným zdrojom každého nálezu.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/65 sm:text-lg">
          {BRAND.tagline} Každý analytický výstup treba overiť voči originálnym podkladom.
        </p>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-6 pb-16 md:grid-cols-2" aria-label="Dostupné plány">
        {Object.values(PLANS).map((plan) => {
          const isPro = plan.id === "pro";
          return (
            <article
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-6 sm:p-8 ${
                isPro
                  ? "border-emerald-300/50 bg-emerald-300/5 shadow-[0_0_40px_rgba(110,231,183,0.08)]"
                  : "border-white/10 bg-white/[0.025]"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-bold">{plan.name}</h2>
                  {isPro && (
                    <span className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                      14 dní na skúšku
                    </span>
                  )}
                </div>
                <p className="mt-2 min-h-10 text-sm leading-6 text-white/60">
                  {plan.description}
                </p>
                <p className="mt-5 text-4xl font-black tracking-tight">
                  {plan.amount ? `${plan.amount} €` : "Zadarmo"}
                  {plan.amount && <span className="ml-1 text-sm font-medium text-white/50">/ mesiac</span>}
                </p>
                {isPro && (
                  <p className="mt-2 text-sm leading-6 text-white/60">
                    Prvých 14 dní bez mesačného poplatku. SumUp pri uložení karty vykoná autorizačnú platbu 1 € a okamžite ju refunduje. Potom sa automaticky účtuje {plan.amount} € mesačne, kým predplatné nezrušíte.
                  </p>
                )}
                <ul className="mt-6 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm text-white/80">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                href={isPro ? "/auth/login?mode=signup&next=%2Fforza%2Fpredplatne" : "/auth/login?mode=signup&next=%2Fforza"}
                className={`mt-8 inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-bold transition ${
                  isPro
                    ? "bg-emerald-300 text-[#07171c] hover:bg-emerald-200"
                    : "border border-white/20 text-white hover:bg-white/5"
                }`}
              >
                {isPro ? "Vyskúšať Pro" : "Vytvoriť bezplatný účet"}
              </Link>
            </article>
          );
        })}
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16 text-center">
        <p className="mx-auto max-w-3xl text-xs leading-5 text-white/45">
          ForenX poskytuje analytické indikácie z údajov, ktoré zadáte. Výstupy AI nie sú dôkazom trestnej činnosti ani právnym stanoviskom; pred použitím ich overte voči originálu.
        </p>
      </section>
    </main>
  );
}
