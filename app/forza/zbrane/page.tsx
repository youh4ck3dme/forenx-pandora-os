"use client";

import { AddPanel, WeaponForm } from "@/components/malte/CaseForms";
import { useActiveCase } from "@/hooks/useActiveCase";
import { ShieldAlert } from "lucide-react";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  RiskChip,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import {
  detectSerialBatches,
  EUROPOL_STATUS_LABEL,
  formatDate,
} from "@/lib/forza/forensic";
import { BRAND } from "@/config/brand";
import { DevilsAdvocatePanel } from "@/components/features/forensic/DevilsAdvocatePanel";
import { AdmissibilityAuditView } from "@/components/features/forensic/AdmissibilityAuditView";
import { CustodyLedgerViewer } from "@/components/features/forensic/CustodyLedgerViewer";
import { EmptyState, ForzaModuleSkeleton } from "@/components/malte/EmptyState";
import { Button } from "@/components/ui/button";
import { collectCustodyEvidenceIds } from "@/lib/forza/evidence-binding";

export default function ZbranePage() {
  return <Weapons />;
}

function Weapons() {
  const { activeCase, analysis, dossier, refresh, loading } = useActiveCase();
  const names = new Map(activeCase.entities.map((e) => [e.id, e.name]));
  const batches = detectSerialBatches(activeCase.weapons);
  const matches = analysis.weapons.filter((w) => w.europolMatch).length;
  const knownEvidence = dossier
    ? collectCustodyEvidenceIds(dossier)
    : new Set<string>();

  if (loading) {
    return (
      <PhoneFrame>
        <AppHeader title="Zbrane" back />
        <Screen><ForzaModuleSkeleton /></Screen>
        <BottomNav />
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <AppHeader title="Zbrane" back />

      <Screen>
        <AddPanel label="Pridať zbraň">
          <WeaponForm
            caseId={activeCase.id}
            entities={activeCase.entities}
            onSaved={refresh}
          />
        </AddPanel>
        <Card className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-risk-high/12 text-risk-high">
            <ShieldAlert className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">
              {matches} z {analysis.weapons.length} zbraní na sledovanom zozname
            </p>
            <p className="text-[11px] text-muted-foreground">
              Kontrola sériových čísel a platnosti licencií
            </p>
          </div>
        </Card>

        <SectionTitle>Evidencia</SectionTitle>

        {analysis.weapons.length === 0 ? (
          <EmptyState
            title="Zatiaľ žiadne zbrane"
            detail="Pridajte prvú zbraň vyššie po pridaní držiteľa a dodávateľa do prípadu."
            action={<Button asChild size="sm" variant="outline"><a href="/forza/pripady">Pridať subjekty</a></Button>}
          />
        ) : (
          <Card className="divide-y divide-border p-0">
            {analysis.weapons.map(
            ({
              weapon,
              europolMatch,
              invalidLicence,
              europolRecord,
              fuzzyMatch,
            }) => (
              <div key={weapon.id} className="space-y-1 p-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {weapon.brand} {weapon.model}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground tnum">
                      {weapon.serial} • {formatDate(weapon.acquiredAt)}
                    </p>
                  </div>
                  <span className="ml-auto">
                    <RiskChip
                      level={
                        europolMatch
                          ? "critical"
                          : invalidLicence
                            ? "high"
                            : "low"
                      }
                    >
                      {europolMatch
                        ? "Sledovaná"
                        : invalidLicence
                          ? "Bez licencie"
                          : "Čisté"}
                    </RiskChip>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Držiteľ {names.get(weapon.holderId) ?? weapon.holderId} •
                  dodávateľ {names.get(weapon.supplierId) ?? weapon.supplierId}
                </p>
                {europolRecord ? (
                  <p className="rounded-lg bg-risk-high/10 px-2 py-1 text-[11px] text-risk-high">
                    {fuzzyMatch ? "Pravdepodobná zhoda" : "Zhoda"} •{" "}
                    {europolRecord.caseRef} • {europolRecord.seizedCountry} •{" "}
                    {EUROPOL_STATUS_LABEL[europolRecord.status]} •{" "}
                    {formatDate(europolRecord.seizedAt)}
                  </p>
                ) : null}
              </div>
            ),
            )}
          </Card>
        )}

        {batches.length > 0 ? (
          <>
            <SectionTitle>Sekvenčné dávky sériových čísel</SectionTitle>
            <Card className="space-y-2">
              {batches.map((b) => (
                <div key={b.prefix} className="space-y-1">
                  <p className="text-xs font-semibold">
                    Dávka {b.prefix}* — {b.serials.length} zbraní,{" "}
                    {b.holderIds.length} držiteľov
                  </p>
                  <p className="text-[11px] text-muted-foreground tnum">
                    {b.serials.join(", ")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {b.holderIds.map((id) => names.get(id) ?? id).join(", ")}
                  </p>
                </div>
              ))}
            </Card>
          </>
        ) : null}

        <SectionTitle>Forenzné superzbrane</SectionTitle>
        <Card className="space-y-5">
          <DevilsAdvocatePanel
            hypotheses={dossier?.alternativeHypotheses ?? []}
            knownEvidence={knownEvidence}
          />
          <AdmissibilityAuditView
            audit={dossier?.admissibilityAudit}
            knownEvidence={knownEvidence}
          />
          <CustodyLedgerViewer entries={dossier?.custodyLedger ?? []} />
        </Card>
      </Screen>

      <BottomNav />
    </PhoneFrame>
  );
}
