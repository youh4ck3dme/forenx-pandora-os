"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, FolderPlus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { EmptyState } from "@/components/malte/EmptyState";
import { Button } from "@/components/ui/button";
import { useActiveCase } from "@/hooks/useActiveCase";
import { createDevDemoCase } from "@/lib/forza/dev-cases";
import { createCase } from "@/lib/forza/case-data";
import { NewCaseForm } from "@/components/malte/NewCaseForm";
import { StepProgress } from "@/components/malte/StepProgress";
import { EntityForm } from "@/components/malte/CaseForms";
import { EntityList } from "@/components/malte/RecordLists";
import { DeleteRecordButton } from "@/components/malte/DeleteRecordButton";
import { CaseLifecycleMenu } from "@/components/malte/CaseLifecycleMenu";
import { BRAND } from "@/config/brand";

export default function PripadyPage() {
  const {
    cases,
    activeCaseId,
    setActiveCaseId,
    activeCase,
    hasCase,
    refresh,
    revisions,
  } = useActiveCase();
  const [busy, setBusy] = useState(false);

  async function handleCreateDemo() {
    setBusy(true);
    try {
      const id = createDevDemoCase();
      refresh();
      setActiveCaseId(id);
      toast.success("Ukážkový prípad so syntetickými dátami bol vytvorený.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Ukážku sa nepodarilo vytvoriť.";
      toast.error(message, {
        action: { label: "Skúsiť znova", onClick: () => void handleCreateDemo() },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PhoneFrame>
      <AppHeader
        title="Prípady"
        actions={
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("new-case-input");
              if (el) {
                el.focus();
                el.scrollIntoView({ behavior: "smooth" });
              }
            }}
            aria-label="Nový prípad"
            title="Prejsť na formulár nového prípadu"
            className="rounded-full p-1 transition-colors hover:bg-foreground/15 cursor-pointer"
          >
            <FolderPlus className="h-5 w-5 opacity-90" aria-hidden />
          </button>
        }
      />
      <Screen>
        <Card className="space-y-3">
          <StepProgress step={4} label="Nový prípad" />
          <h1 className="text-base font-semibold tracking-tight">
            Nový prípad
          </h1>
          <Link href="/forza/sandbox" className="block">
            <Button type="button" className="min-h-11 w-full">
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
              Nový prípad v AI Sandboxe
            </Button>
          </Link>
          <p className="text-[11px] text-muted-foreground">
            AI načíta nahraté spisy do šifrovaného priestoru prípadu a sama
            spočíta osoby, miesta, vozidlá, zbrane a peniaze.
          </p>
          <NewCaseForm />
          <p className="text-[11px] text-muted-foreground">{BRAND.tagline}</p>
        </Card>

        <Card className="space-y-2">
          <p className="text-sm font-semibold">Ukážkový prípad</p>
          <p className="text-[11px] text-muted-foreground">
            Syntetické dáta bez osobných údajov, výslovne označené ako ukážka.
            Do vašich reálnych prípadov sa nikdy nepridávajú automaticky.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={handleCreateDemo}
          >
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Vytváram…" : "Vytvoriť ukážkový prípad"}
          </Button>
        </Card>

        <SectionTitle>Vaše prípady</SectionTitle>
        {cases.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="Zatiaľ žiadne prípady"
            detail="Vytvorte prvý prípad vyššie, alebo spustite Forenzný Autopilot s nahratým spisom."
            action={
              <Button asChild size="sm">
                <Link href="/forza/asistent">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Otvoriť Autopilot
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {cases.map((item) => (
              <Card key={item.id} className="flex items-center gap-3">
                <button
                  type="button"
                  className="flex-1 text-left cursor-pointer"
                  onClick={() => setActiveCaseId(item.id)}
                >
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="text-caption">
                    {item.subtitle || item.referenceDate}
                  </p>
                </button>
                {activeCaseId === item.id ? (
                  <CheckCircle2
                    className="h-4 w-4 text-primary shrink-0"
                    aria-label="Aktívny prípad"
                  />
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  title="Duplikovať prípad"
                  aria-label={`Duplikovať prípad ${item.name}`}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const newId = await createCase({
                        name: `${item.name} (Kópia)`,
                        subtitle: item.subtitle
                          ? `${item.subtitle} (Duplikát)`
                          : "Duplikát prípadu",
                      });
                      refresh();
                      setActiveCaseId(newId);
                      toast.success(`Prípad "${item.name}" bol duplikovaný.`);
                    } catch (error) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : "Duplikovanie prípadu zlyhalo.";
                      toast.error(message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
                <CaseLifecycleMenu item={item} onChanged={refresh} />
                <DeleteRecordButton
                  type="case"
                  id={item.id}
                  label={item.name}
                  onDeleted={() => {
                    if (activeCaseId === item.id) setActiveCaseId(null);
                    refresh();
                  }}
                />
              </Card>
            ))}
          </div>
        )}

        {hasCase ? (
          <>
            <SectionTitle>Subjekty v prípade {activeCase.name}</SectionTitle>
            <EntityForm caseId={activeCase.id} onSaved={refresh} />

            {activeCase.entities.length === 0 ? (
              <EmptyState
                title="Prípad je zatiaľ prázdny"
                detail="Pridajte prvý subjekt, aby sa spustili detektory."
              />
            ) : (
              <EntityList
                caseId={activeCase.id}
                entities={activeCase.entities}
                revisions={revisions}
                onChanged={refresh}
              />
            )}
          </>
        ) : null}
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
