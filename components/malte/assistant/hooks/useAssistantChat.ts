import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { aiUnavailableReason } from "@/lib/ai/availability";
import {
  assessControlReadiness,
} from "@/lib/ai/control-readiness";
import { OFFLINE_AI_MESSAGE } from "@/hooks/useOnlineStatus";
import {
  AI_CONSENT_MISSING_MESSAGE,
  AI_CONSENT_PREVIEW_FAILED_MESSAGE,
} from "@/lib/ai-consent";
import {
  previewAiPayload,
  runAiTask,
  type AiRunResult,
  type AiTask,
} from "@/lib/ai.functions";
import { upsertTransaction } from "@/lib/case-data";
import type { Suggestion } from "../types";

interface UseAssistantChatParams {
  activeCase: {
    id: string;
    entities?: Array<unknown>;
    transactions: Array<{
      id: string;
      date: string;
      amount: number;
      currency: string;
      method: string;
      fromId: string;
      toId: string;
      payerId?: string;
      originCountry?: string;
      destinationCountry?: string;
      description?: string;
    }>;
    events?: Array<unknown>;
  };
  analysis: {
    alerts: Array<{ id: string; title: string; source: string }>;
  };
  hasCase: boolean;
  isOnline: boolean;
  status: any;
  hasDossier: boolean;
  demoMode: boolean;
  revisions: Record<string, number>;
  ensureConsent: (caseId: string, previewFn: () => Promise<string>) => Promise<string | null>;
}

export function useAssistantChat({
  activeCase,
  analysis,
  hasCase,
  isOnline,
  status,
  hasDossier,
  demoMode,
  revisions,
  ensureConsent,
}: UseAssistantChatParams) {
  const [task, setTask] = useState<AiTask>("case_summary");
  const [alertId, setAlertId] = useState<string>("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  const requestLock = useRef(false);

  const taskReadiness = assessControlReadiness(task, {
    entityCount: activeCase.entities?.length ?? 0,
    transactionCount: activeCase.transactions?.length ?? 0,
    findingCount: analysis.alerts.length,
    eventCount: activeCase.events?.length ?? 0,
    hasDossier: Boolean(hasDossier && !demoMode),
  });

  const quickBlocked = !hasCase
    ? "Najprv vyberte prípad."
    : (aiUnavailableReason(status, "chat", isOnline) ??
      (!taskReadiness.ready ? taskReadiness.message : null) ??
      (task === "explain_finding" &&
      !analysis.alerts.some((a) => a.id === alertId)
        ? "Vyberte nález na vysvetlenie."
        : null));

  const buildTaskPreview = useCallback(
    async (requestedTask: AiTask = task): Promise<string> => {
      const value = await previewAiPayload({
        data: {
          caseId: activeCase.id,
          task: requestedTask,
          ...(requestedTask === "explain_finding" ? { alertId } : {}),
        },
      });
      return JSON.stringify(value.payload, null, 2).slice(0, 1500);
    },
    [activeCase.id, task, alertId],
  );

  const runQuickTask = useCallback(
    async (requestedTask: AiTask = task) => {
      const requestedReadiness = assessControlReadiness(requestedTask, {
        entityCount: activeCase.entities?.length ?? 0,
        transactionCount: activeCase.transactions?.length ?? 0,
        findingCount: analysis.alerts.length,
        eventCount: activeCase.events?.length ?? 0,
        hasDossier: Boolean(hasDossier && !demoMode),
      });

      const requestedBlocked = !hasCase
        ? "Najprv vyberte prípad."
        : (aiUnavailableReason(status, "chat", isOnline) ??
          (!requestedReadiness.ready ? requestedReadiness.message : null) ??
          (requestedTask === "explain_finding" &&
          !analysis.alerts.some((a) => a.id === alertId)
            ? "Vyberte nález na vysvetlenie."
            : null));

      if (requestedBlocked || requestLock.current) return;
      requestLock.current = true;
      setBusy(true);

      if (!isOnline) {
        toast.warning(OFFLINE_AI_MESSAGE);
        requestLock.current = false;
        setBusy(false);
        return;
      }

      let consentVersion: string | null = null;
      try {
        consentVersion = await ensureConsent(activeCase.id, () =>
          buildTaskPreview(requestedTask),
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : AI_CONSENT_PREVIEW_FAILED_MESSAGE,
        );
        requestLock.current = false;
        setBusy(false);
        return;
      }

      if (!consentVersion) {
        toast.warning(AI_CONSENT_MISSING_MESSAGE);
        requestLock.current = false;
        setBusy(false);
        return;
      }

      setBusy(true);
      setResult(null);
      try {
        const value = await runAiTask({
          data: {
            caseId: activeCase.id,
            task: requestedTask,
            consentVersion,
            ...(requestedTask === "explain_finding" ? { alertId } : {}),
          },
        });
        setResult(value);
        if (value.status === "not_ready") {
          toast.warning(value.message ?? "Kontrola nie je pripravená.");
        } else if (value.status === "no_findings") {
          toast.message(value.message ?? "Kontrola nenašla žiadne nálezy.");
        } else if (value.status !== "ok") {
          toast.error(value.message ?? "Volanie AI zlyhalo.");
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Volanie AI zlyhalo.",
        );
      } finally {
        requestLock.current = false;
        setBusy(false);
      }
    },
    [
      task,
      activeCase,
      analysis,
      hasCase,
      hasDossier,
      demoMode,
      status,
      isOnline,
      alertId,
      ensureConsent,
      buildTaskPreview,
    ],
  );

  const showPreview = useCallback(async () => {
    try {
      const value = await previewAiPayload({
        data: {
          caseId: activeCase.id,
          task,
          ...(task === "explain_finding" ? { alertId } : {}),
        },
      });
      setPreview(JSON.stringify(value.payload, null, 2));
    } catch {
      toast.error("Náhľad sa nepodarilo zostaviť.");
    }
  }, [activeCase.id, task, alertId]);

  const acceptSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      const output = result?.status === "ok" ? result.output : null;
      const realId = output?.idMap?.transactions?.[suggestion.transaction];
      const transaction = activeCase.transactions.find((t) => t.id === realId);
      if (!transaction) {
        toast.error("Transakcia sa už nenašla — obnovte prípad.");
        return;
      }
      try {
        await upsertTransaction({
          data: {
            id: transaction.id,
            expectedRevision: revisions[transaction.id],
            caseId: activeCase.id,
            date: transaction.date,
            amount: transaction.amount,
            currency: transaction.currency,
            method: transaction.method === "cash" ? "cash" : "transfer",
            fromId: transaction.fromId,
            toId: transaction.toId,
            payerId: transaction.payerId,
            originCountry: transaction.originCountry || "SK",
            destinationCountry: transaction.destinationCountry || "SK",
            description: suggestion.normalized,
          },
        });
        setAccepted((prev) => ({ ...prev, [suggestion.transaction]: true }));
        toast.success("Popis transakcie bol aktualizovaný.");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Aktualizácia zlyhala.",
        );
      }
    },
    [result, activeCase.transactions, activeCase.id, revisions],
  );

  return {
    task,
    setTask,
    alertId,
    setAlertId,
    preview,
    setPreview,
    busy,
    result,
    setResult,
    accepted,
    quickBlocked,
    runQuickTask,
    showPreview,
    acceptSuggestion,
  };
}
