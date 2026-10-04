import React from "react";
import { Bot, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/malte/Shell";
import { OFFLINE_AI_MESSAGE } from "@/hooks/useOnlineStatus";
import type { AiRunResult, AiTask } from "@/lib/ai.functions";
import { TASK_LABELS, type Suggestion } from "./types";

interface QuickTasksSectionProps {
  isOnline: boolean;
  hasCase: boolean;
  task: AiTask;
  setTask: (task: AiTask) => void;
  alertId: string;
  setAlertId: (id: string) => void;
  alerts: Array<{ id: string; title: string; source: string }>;
  quickBlocked: string | null;
  busy: boolean;
  isProcessing: boolean;
  runQuickTask: (requestedTask?: AiTask) => Promise<void>;
  showPreview: () => Promise<void>;
  preview: string | null;
  setPreview: (val: string | null) => void;
  status: any;
  result: AiRunResult | null;
  accepted: Record<string, boolean>;
  acceptSuggestion: (suggestion: Suggestion) => Promise<void>;
}

export function QuickTasksSection({
  isOnline,
  hasCase,
  task,
  setTask,
  alertId,
  setAlertId,
  alerts,
  quickBlocked,
  busy,
  isProcessing,
  runQuickTask,
  showPreview,
  preview,
  setPreview,
  status,
  result,
  accepted,
  acceptSuggestion,
}: QuickTasksSectionProps) {
  const output = result?.status === "ok" ? (result.output as any) : null;
  const text = output?.summary ?? output?.explanation ?? "";
  const suggestions = (output?.suggestions as Suggestion[] | undefined) ?? [];

  return (
    <>
      {!isOnline ? (
        <Card className="border-risk-medium/30 bg-risk-medium/10 p-3 text-xs font-medium text-risk-medium">
          {OFFLINE_AI_MESSAGE}
        </Card>
      ) : null}
      <SectionTitle>Výber úlohy</SectionTitle>

      <div className="space-y-2">
        {(Object.keys(TASK_LABELS) as AiTask[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTask(t)}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              task === t
                ? "border-primary bg-primary/10"
                : "border-border bg-card text-card-foreground hover:bg-muted/50"
            }`}
          >
            <p className="text-sm font-medium">{TASK_LABELS[t]}</p>
          </button>
        ))}
      </div>

      {task === "explain_finding" ? (
        <>
          <SectionTitle>Vyberte nález na vysvetlenie</SectionTitle>
          <div className="space-y-1.5">
            {alerts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAlertId(a.id)}
                className={`w-full rounded-md border p-2 text-left text-xs ${
                  alertId === a.id
                    ? "border-primary bg-primary/15"
                    : "border-border bg-card text-card-foreground"
                }`}
              >
                <span className="font-semibold">{a.title}</span>
                <span className="ml-2 text-caption">({a.source})</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {quickBlocked && (
        <p role="status" className="text-xs text-risk-medium">
          {quickBlocked}
        </p>
      )}
      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => void runQuickTask()}
          disabled={busy || isProcessing || Boolean(quickBlocked)}
          className="flex-1"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Bot className="mr-2 h-4 w-4" />
          )}
          {isOnline ? "Spustiť úlohu" : "AI vyžaduje internet"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void showPreview()}
          disabled={!hasCase}
          className="gap-1.5"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden sm:inline">Náhľad údajov</span>
        </Button>
      </div>

      {preview ? (
        <>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Skryť
              </button>
            }
          >
            Údaje odosielané modelu
          </SectionTitle>
          <Card className="space-y-2 p-3 text-xs animate-fade-in">
            <p className="text-caption">
              Presne toto sa odošle poskytovateľovi (
              {status?.data?.providerName ?? "AI"}). Mená a identifikátory
              sú nahradené pseudonymami; preklad späť prebieha na serveri.
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
              {preview}
            </pre>
          </Card>
        </>
      ) : null}

      {result && (
        <p
          role={
            result.status === "ok" || result.status === "no_findings"
              ? "status"
              : "alert"
          }
          data-ai-result={result.status}
          className="text-xs"
        >
          {result.status === "ok"
            ? "Mistral dokončil úlohu."
            : (result.message ?? "Kontrola bola dokončená bez nálezov.")}
        </p>
      )}

      {result?.status === "not_ready" ? (
        <Card className="space-y-2 p-3 text-xs">
          <p className="font-medium">{result.message}</p>
          {result.missing?.length ? (
            <p className="text-muted-foreground">
              Chýba: {result.missing.join(", ")}.
            </p>
          ) : null}
        </Card>
      ) : null}

      {result?.status === "no_findings" ? (
        <Card className="space-y-2 p-3 text-xs text-muted-foreground">
          <p>
            {result.control?.summary ??
              result.message ??
              "Kontrola nenašla žiadne nálezy."}
          </p>
        </Card>
      ) : null}

      {result?.status === "ok" &&
      (text ||
        (output?.hypotheses && output.hypotheses.length > 0) ||
        output?.courtReadySummary ||
        (suggestions && suggestions.length > 0)) ? (
        <>
          <SectionTitle>Výsledok</SectionTitle>
          {text ? (
            <Card className="space-y-2 p-3 text-xs">
              <p className="whitespace-pre-wrap">{text}</p>
            </Card>
          ) : null}

          {output?.hypotheses?.map((h: any) => (
            <Card key={h.id} className="space-y-2 p-3 text-xs">
              <p className="font-semibold">{h.title}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {h.scenario}
              </p>
              {h.explainedEvidence && h.explainedEvidence.length > 0 ? (
                <p>Vysvetľuje: {h.explainedEvidence.join("; ")}</p>
              ) : null}
              {h.requiredTracesIfTrue &&
              h.requiredTracesIfTrue.length > 0 ? (
                <p>
                  Ak pravda, v spise by muselo byť:{" "}
                  {h.requiredTracesIfTrue.join("; ")}
                </p>
              ) : null}
              {h.rebuttalTest ? <p>Test: {h.rebuttalTest}</p> : null}
            </Card>
          ))}

          {output?.courtReadySummary ? (
            <Card className="space-y-2 p-3 text-xs">
              <p className="font-semibold">
                Procesný stav: {output.overallStatus ?? "—"}
                {typeof output.score === "number"
                  ? ` (${output.score}/100)`
                  : ""}
              </p>
              <p className="whitespace-pre-wrap">
                {output.courtReadySummary}
              </p>
              {output.defects?.map((d: any, i: number) => (
                <div
                  key={`${d.paragraph}-${i}`}
                  className="rounded-md border border-border p-2"
                >
                  <p className="font-medium">
                    {d.severity} · {d.paragraph}
                  </p>
                  <p className="text-muted-foreground">{d.description}</p>
                  <p>Náprava: {d.remedyAction}</p>
                </div>
              ))}
            </Card>
          ) : null}

          {suggestions.map((s) => (
            <Card
              key={s.transaction}
              className="flex items-start justify-between gap-2 p-3 text-xs"
            >
              <div className="space-y-1">
                <p className="font-medium">{s.normalized}</p>
                <p className="text-muted-foreground">
                  {s.transaction}
                  {s.counterparty ? ` · ${s.counterparty}` : ""}
                  {s.confidence ? ` · ${s.confidence}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(accepted[s.transaction])}
                onClick={() => void acceptSuggestion(s)}
              >
                {accepted[s.transaction] ? "Prijaté" : "Prijať"}
              </Button>
            </Card>
          ))}
        </>
      ) : result?.status === "ok" ? (
        <Card className="p-3 text-xs text-muted-foreground">
          Úloha prebehla, ale výstup nemá zobraziteľný obsah.
        </Card>
      ) : null}
    </>
  );
}
