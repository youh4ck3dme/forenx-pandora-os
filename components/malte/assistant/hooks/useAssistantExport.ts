import { useState, useCallback } from "react";
import { toast } from "sonner";
import { exportDossierToPDF } from "@/lib/export-pdf";
import { isDemoDossier } from "@/lib/autopilot-meta";
import type { ForensicDossier } from "@/lib/types";
import { useWebAuthnSignature } from "./useWebAuthnSignature";

interface UseAssistantExportParams {
  dossier: ForensicDossier | null;
  activeCaseId?: string;
  demoMode: boolean;
  saveCaseDossierFn: (opts: { data: { caseId: string; dossier: ForensicDossier } }) => Promise<{ success: boolean }>;
  /** Hash-overené dôkazy z WORM ledgera (useVerifiedEvidence); bez nich nie je v exporte nič viazané. */
  knownEvidence: ReadonlySet<string>;
}

export function useAssistantExport({
  dossier,
  activeCaseId,
  demoMode,
  saveCaseDossierFn,
  knownEvidence,
}: UseAssistantExportParams) {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isSavingDossier, setIsSavingDossier] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedJudgeText, setCopiedJudgeText] = useState(false);

  const { signDossier } = useWebAuthnSignature();

  const handleExportPDF = useCallback(async () => {
    if (!dossier || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      if (demoMode || isDemoDossier(dossier)) {
        exportDossierToPDF(dossier, { knownEvidence });
        toast.success(
          "AI pracovná analýza (A4) so SHA-256 odtlačkom bola pripravená na tlač/stiahnutie.",
        );
        return;
      }
      const signatureData = await signDossier(dossier);
      exportDossierToPDF(
        dossier,
        signatureData.investigator
          ? {
              investigator: signatureData.investigator,
              webauthn: signatureData.webauthn,
              knownEvidence,
            }
          : { knownEvidence },
      );
      toast.success(
        "AI pracovná analýza (A4) so SHA-256 odtlačkom bola pripravená na tlač/stiahnutie.",
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [dossier, isExportingPdf, signDossier, demoMode, knownEvidence]);

  const handleSaveDossier = useCallback(async () => {
    if (!dossier) {
      toast.error("Žiadna vygenerovaná analýza na uloženie.");
      return;
    }
    if (demoMode || isDemoDossier(dossier)) {
      toast.error(
        "Syntetická ukážka sa neukladá do produkčného prípadu. Nahrajte reálny spis.",
      );
      return;
    }
    if (!activeCaseId) {
      toast.error("Nie je vybratý aktívny prípad pre uloženie analýzy.");
      return;
    }

    setIsSavingDossier(true);
    setSaveError(null);
    try {
      const res = await saveCaseDossierFn({
        data: {
          caseId: activeCaseId,
          dossier,
        },
      });
      if (res && res.success) {
        const timeStr = new Date().toLocaleTimeString("sk-SK", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        setLastSavedAt(timeStr);
        setSaveError(null);
        toast.success(
          `AI pracovná analýza bola uložená do prípadu (${timeStr}).`,
        );
      } else {
        const msg = "Uloženie analýzy do databázy zlyhalo.";
        setSaveError(msg);
        toast.error(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("42703") ||
        msg.includes("forensic_dossier") ||
        msg.toLowerCase().includes("column")
      ) {
        console.warn("Supabase column forensic_dossier missing:", msg);
        const warn =
          "Databázová schéma ešte neobsahuje stĺpec forensic_dossier (migrácia čaká). Spis je len v lokálnom stave.";
        setSaveError(warn);
        toast.warning(warn, { duration: 6000 });
      } else {
        setSaveError(msg);
        toast.error(`Chyba pri ukladaní: ${msg}`);
      }
    } finally {
      setIsSavingDossier(false);
    }
  }, [activeCaseId, demoMode, dossier, saveCaseDossierFn]);

  const handleCopyJudgeText = useCallback(() => {
    if (!dossier) return;
    const fullText = `ROZSUDKOVÝ FORMÁT (§ 168 TP) — ${dossier.caseTitle}
Spis: ${dossier.caseId}

I. ZISTENÝ SKUTKOVÝ STAV:
${dossier.judgeReadyText.skutkovyStav}

II. VYPORIADANIE SA S OBHAJOBOU OBVINENÉHO:
${dossier.judgeReadyText.vyporiadanie}

III. VEDECKÉ ZHODNOTENIE STÔP (LR & METODIKA):
${dossier.judgeReadyText.vedecke}`;

    void navigator.clipboard.writeText(fullText).then(
      () => {
        setCopiedJudgeText(true);
        toast.success(
          "Kompletné odôvodnenie (§ 168 TP) skopírované do schránky.",
        );
        setTimeout(() => setCopiedJudgeText(false), 2000);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo.");
      },
    );
  }, [dossier]);

  return {
    isExportingPdf,
    isSavingDossier,
    lastSavedAt,
    saveError,
    copiedJudgeText,
    handleExportPDF,
    handleSaveDossier,
    handleCopyJudgeText,
    setLastSavedAt,
    setSaveError,
  };
}
