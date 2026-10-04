import React from "react";
import { Card } from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import { Copy, Check, Save, Loader2, Download } from "lucide-react";

interface AssistantExportCardProps {
  copiedJudgeText: boolean;
  isSavingDossier: boolean;
  lastSavedAt: string | null;
  isExportingPdf: boolean;
  demoMode?: boolean;
  onCopyJudgeText: () => void;
  onSaveDossier: () => void;
  onExportPDF: () => void;
}

export function AssistantExportCard({
  copiedJudgeText,
  isSavingDossier,
  lastSavedAt,
  isExportingPdf,
  demoMode,
  onCopyJudgeText,
  onSaveDossier,
  onExportPDF,
}: AssistantExportCardProps) {
  return (
    <Card
      id="tour-export-pdf"
      className="p-3.5 bg-primary/5 border-primary/20 space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
            Export AI pracovnej analýzy
          </h4>
          <p className="text-[11px] text-muted-foreground">
            Návrh odôvodnenia (§ 168 TP), PDF s pečaťou integrity a
            uloženie do prípadu — nie znalecký posudok
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyJudgeText}
            className="gap-1.5 text-xs h-8 cursor-pointer"
          >
            {copiedJudgeText ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Skopírované
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Kopírovať text
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onSaveDossier}
            disabled={isSavingDossier || demoMode}
            className="gap-1.5 text-xs h-8 cursor-pointer border-primary/40 hover:bg-primary/10"
            title={
              demoMode
                ? "Demo sa neukladá do produkčného prípadu"
                : "Uložiť vygenerovanú analýzu priamo do prípadu"
            }
          >
            {isSavingDossier ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Ukladám...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5 text-primary" />
                {lastSavedAt ? `Uložené (${lastSavedAt})` : "Uložiť do prípadu"}
              </>
            )}
          </Button>

          <Button
            size="sm"
            onClick={onExportPDF}
            disabled={isExportingPdf}
            className="gap-1.5 h-8 cursor-pointer font-semibold shadow-xs"
            title="Vygenerovať A4 PDF (AI pracovná analýza) so SHA-256 pečaťou"
          >
            <Download className="h-3.5 w-3.5" />
            Stiahnuť AI pracovnú analýzu (PDF)
          </Button>
        </div>
      </div>
    </Card>
  );
}
