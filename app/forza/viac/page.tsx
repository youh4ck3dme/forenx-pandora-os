"use client";

import { useActiveCase } from "@/hooks/useActiveCase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { navGroups } from "@/components/malte/nav";
import { ChevronRight, Download, LogOut } from "lucide-react";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  RiskChip,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/malte/ThemeToggle";
import { useCaseStore } from "@/hooks/useCaseStore";
import { exportCaseReport } from "@/lib/forza/report";
import { toast } from "sonner";
import { formatDate, severityLabel } from "@/lib/forza/forensic";
import { BRAND } from "@/config/brand";

export default function ViacPage() {
  return <More />;
}

function More() {
  const { activeCase, analysis } = useActiveCase();
  const { state, countExport, reset } = useCaseStore();
  const router = useRouter();

  const exportReport = () => {
    if (exportCaseReport(analysis, state.riskFilter)) {
      countExport();
      toast.success("Správa vygenerovaná — uložte ako PDF v dialógu tlače.");
    } else {
      toast.error("Export sa nepodarilo spustiť.");
    }
  };

  return (
    <PhoneFrame>
      <AppHeader title="Viac a nastavenia" />
      <Screen>
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Aktivny prípad
            </span>
            <RiskChip level={analysis.caseLevel}>
              {severityLabel[analysis.caseLevel]}
            </RiskChip>
          </div>
          <p className="text-base font-bold text-foreground">{activeCase.name}</p>
          <p className="text-caption">{activeCase.subtitle}</p>
        </Card>

        {navGroups.map((group) => (
          <div key={group.title} className="space-y-1.5">
            <SectionTitle>{group.title}</SectionTitle>
            <Card className="divide-y divide-border p-0">
              {group.items.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  href={to}
                  className="flex items-center gap-3 p-3.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span>{label}</span>
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/60" />
                </Link>
              ))}
            </Card>
          </div>
        ))}

        <Button size="lg" className="w-full mt-4" onClick={exportReport}>
          <Download className="mr-2 h-4 w-4" />
          Exportovať správu do PDF
        </Button>
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
