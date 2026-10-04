"use client";

import { BrainCircuit, CircleAlert, Crosshair, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { AlternativeHypothesis } from "@/lib/forza/types";
import { partitionAlternativeHypotheses } from "@/lib/forza/evidence-binding";

type DevilsAdvocatePanelProps = {
  hypotheses: AlternativeHypothesis[];
  knownEvidence?: ReadonlySet<string>;
  onSimulate?: () => void;
  isSimulating?: boolean;
};

export function probabilityTone(score: number) {
  if (score >= 67) return "text-rose-400 border-rose-500/30 bg-rose-500/10";
  if (score >= 34) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
}

export function DevilsAdvocatePanel({
  hypotheses,
  knownEvidence = new Set<string>(),
  onSimulate,
  isSimulating = false,
}: DevilsAdvocatePanelProps) {
  const partition = partitionAlternativeHypotheses(hypotheses, knownEvidence);
  return (
    <section className="space-y-3" aria-label="Devil's Advocate">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-rose-400">
            Devil&apos;s Advocate
          </p>
          <p className="text-caption">
            Alternatívne vysvetlenia sa musia overiť pred ich odmietnutím.
          </p>
        </div>
        {onSimulate ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isSimulating}
            onClick={onSimulate}
          >
            <BrainCircuit className="h-3.5 w-3.5 text-rose-400" />
            {isSimulating ? "Simulujem Mistral AI..." : "Simulovať protiútok"}
          </Button>
        ) : null}
      </div>

      {partition.bound.length === 0 && partition.unbound.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          Alternatívne hypotézy zatiaľ neboli vygenerované. Simulácia pracuje
          iba s dôkazmi aktuálneho spisu.
        </div>
      ) : (
        partition.bound.map((hypothesis) => (
          <article
            key={hypothesis.id}
            className="space-y-3 rounded-xl border border-rose-500/20 bg-card text-card-foreground p-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{hypothesis.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {hypothesis.scenario}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-1 font-mono text-[10px] font-bold ${probabilityTone(hypothesis.probabilityScore)}`}
              >
                {hypothesis.probabilityScore} % ALTERNATÍVA
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <EvidenceList
                icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
                title="Vysvetľuje dôkazy"
                items={hypothesis.evidence}
                tone="border-emerald-500/20 bg-emerald-500/5"
              />
              <EvidenceList
                icon={<CircleAlert className="h-3.5 w-3.5 text-amber-400" />}
                title="Chýbajúce stopy na overenie"
                items={hypothesis.requiredTraces}
                tone="border-amber-500/20 bg-amber-500/5"
              />
            </div>

            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                <Crosshair className="h-3.5 w-3.5" /> Protiargument / test
              </p>
              <p className="mt-1 text-xs leading-relaxed">{hypothesis.rebuttal}</p>
            </div>
          </article>
        ))
      )}
      {partition.unbound.length > 0 ? (
        <aside className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
            Neoverené tvrdenia (nie sú skutkom)
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {partition.unbound.map((hypothesis) => (
              <li key={hypothesis.id}>
                <strong>{hypothesis.title}</strong>
                <p className="text-muted-foreground">{hypothesis.scenario}</p>
                <span className="text-[10px] text-muted-foreground">
                  Chýba platný odkaz na existujúci dôkaz a stranu alebo odsek.
                </span>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </section>
  );
}

function EvidenceList({
  icon,
  title,
  items,
  tone,
}: {
  icon: ReactNode;
  title: string;
  items: string[];
  tone: string;
}) {
  return (
    <div className={`rounded-lg border p-2.5 ${tone}`}>
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
        {icon} {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5 text-[11px] leading-relaxed">
            <span aria-hidden>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
