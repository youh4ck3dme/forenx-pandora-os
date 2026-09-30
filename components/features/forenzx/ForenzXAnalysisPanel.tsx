"use client";

import { useState, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getForenZXTools, getForenZXJobs } from "@/lib/forza/forenzx-mcp.functions";
import { useForenzxJobEvents } from "@/lib/hooks/useForenzxJobEvents";
import type { ForenZXTool, ForenZXJob } from "@/lib/forza/forenzx-mcp.functions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StartAnalysisPayload {
  caseId: string;
  evidenceId: string;
  s3ObjectKey: string;
  sha256: string;
  inputType: string;
  packId?: string;
}

export interface ForenzXAnalysisPanelProps {
  /** UUID of the case in Pandora */
  caseId?: string;
  /** UUID of the evidence item */
  evidenceId?: string;
  /** S3 object key for the evidence file */
  s3ObjectKey?: string;
  /** SHA-256 from the Pandora evidence ledger */
  sha256?: string;
  /** Evidence input type (e.g. "ios_backup") */
  inputType?: string;
  /** Pack to run — defaults to "mobile_compromise" */
  packId?: string;
  className?: string;
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full bg-linear-to-r from-cyan-500 to-violet-500 transition-all duration-500 rounded-full"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  starting: "text-yellow-400 bg-yellow-400/10",
  queued:   "text-blue-400 bg-blue-400/10",
  running:  "text-cyan-400 bg-cyan-400/10",
  completed:"text-emerald-400 bg-emerald-400/10",
  failed:   "text-red-400 bg-red-400/10",
  cancelled:"text-zinc-400 bg-zinc-400/10",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status.toLowerCase()] ?? "text-zinc-300 bg-zinc-300/10";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {status}
    </span>
  );
}

// ── Tool card (tools/list) ────────────────────────────────────────────────────

function ToolCard({ tool }: { tool: ForenZXTool }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-cyan-500/30 transition-colors">
      <span className="text-xs font-mono text-cyan-300 truncate">{tool.name}</span>
      {tool.description && (
        <span className="text-xs text-zinc-400 line-clamp-2">{tool.description}</span>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ForenzXAnalysisPanel({
  caseId = "",
  evidenceId = "",
  s3ObjectKey = "",
  sha256 = "",
  inputType = "mobile_generic_archive",
  packId = "mobile_compromise",
  className = "",
}: ForenzXAnalysisPanelProps) {
  const [tools, setTools] = useState<ForenZXTool[] | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<ForenZXJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { status: jobStatus, connected, error: sseError } = useForenzxJobEvents(activeJobId);

  // ── Load tools/list ────────────────────────────────────────────────────────

  const loadTools = useCallback(async () => {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const result = await getForenZXTools();
      setTools(result);
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : "tools/list failed");
    } finally {
      setToolsLoading(false);
    }
  }, []);

  // ── Load jobs ──────────────────────────────────────────────────────────────

  const loadJobs = useCallback(async () => {
    if (!caseId) return;
    try {
      const { jobs: rows } = await getForenZXJobs({ caseId });
      setJobs(rows);
      // Auto-attach to the most recent running/queued job
      const active = rows.find((job: ForenZXJob) => ["running", "queued", "starting"].includes(job.status));
      if (active?.hub_job_id) setActiveJobId(active.hub_job_id);
    } catch {
      // Non-critical
    }
  }, [caseId]);

  // Auto-load on mount
  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  useEffect(() => {
    if (caseId) void loadJobs();
  }, [caseId, loadJobs]);

  // ── Start analysis ─────────────────────────────────────────────────────────

  const startAnalysis = useCallback(async () => {
    if (!caseId || !evidenceId || !s3ObjectKey || !sha256) {
      setStartError("Pre spustenie analýzy je potrebné vybrať dôkaz (chýbajú caseId/evidenceId/s3Key/hash).");
      return;
    }
    setStartLoading(true);
    setStartError(null);
    try {
      const payload: StartAnalysisPayload = {
        caseId,
        evidenceId,
        s3ObjectKey,
        sha256,
        inputType,
        packId,
      };

      const response = await fetch("/api/forenzx/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorBody.error ?? `HTTP ${response.status}`);
      }

      const { jobId } = await response.json() as { jobId: string };
      if (!jobId) throw new Error("Server nevrátil jobId.");
      setActiveJobId(jobId);

      // Refresh job list
      if (caseId) {
        const { jobs: updated } = await getForenZXJobs({ caseId });
        setJobs(updated);
      }
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Spustenie analýzy zlyhalo.");
    } finally {
      setStartLoading(false);
    }
  }, [caseId, evidenceId, s3ObjectKey, sha256, inputType, packId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-zinc-950/80 backdrop-blur-sm p-5 flex flex-col gap-5 ${className}`}
      aria-label="ForenZX Analysis Panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-cyan-400 text-lg" aria-hidden>⬡</span>
          <h2 className="text-sm font-semibold text-white tracking-tight">ForenZX MCP Hub</h2>
        </div>
        {connected && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            SSE live
          </span>
        )}
      </div>

      {/* Tools/list section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Dostupné nástroje</span>
          <button
            id="forenzx-load-tools"
            onClick={loadTools}
            disabled={toolsLoading}
            className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-40 transition-colors"
            aria-label="Načítať zoznam ForenZX nástrojov"
          >
            {toolsLoading ? "Načítavam…" : tools ? "Obnoviť" : "Načítať tools/list"}
          </button>
        </div>

        {toolsError && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2" role="alert">
            {toolsError}
          </p>
        )}

        {tools && tools.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {tools.map((tool) => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        )}

        {tools && tools.length === 0 && (
          <p className="text-xs text-zinc-500 italic">Hub nevrátil žiadne nástroje.</p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-white/5" />

      {/* Start analysis */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Spustiť analýzu</span>
            <span className="text-xs text-zinc-500">
              Pack: <span className="text-zinc-300 font-mono">{packId}</span>
              {" · "}
              Typ: <span className="text-zinc-300 font-mono">{inputType}</span>
            </span>
          </div>
          <button
            id="forenzx-start-analysis"
            onClick={startAnalysis}
            disabled={startLoading || jobStatus?.state === "running"}
            className={[
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
              "bg-linear-to-r from-cyan-600 to-violet-600 text-white",
              "hover:from-cyan-500 hover:to-violet-500 shadow-lg hover:shadow-cyan-500/20",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
            ].join(" ")}
            aria-label="Spustiť ForenZX forenzickú analýzu"
          >
            {startLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Spúšťam…
              </>
            ) : (
              <>
                <span aria-hidden>▶</span>
                Spustiť analýzu
              </>
            )}
          </button>
        </div>

        {startError && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2" role="alert">
            {startError}
          </p>
        )}
      </div>

      {/* Live job status (SSE) */}
      {(activeJobId || jobStatus) && (
        <>
          <div className="border-t border-white/5" />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Priebeh úlohy</span>
              {jobStatus && <StatusBadge status={jobStatus.state} />}
            </div>

            {jobStatus && (
              <>
                <ProgressBar percent={jobStatus.progress_percent} />
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="font-mono truncate">{jobStatus.current_stage || "—"}</span>
                  <span>{jobStatus.progress_percent}%</span>
                </div>
                {jobStatus.error_message && (
                  <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2" role="alert">
                    {jobStatus.error_message}
                  </p>
                )}
              </>
            )}

            {sseError && (
              <p className="text-xs text-yellow-400 bg-yellow-400/10 rounded-lg px-3 py-2" role="status">
                SSE: {sseError}
              </p>
            )}

            {!jobStatus && !sseError && activeJobId && (
              <p className="text-xs text-zinc-500 animate-pulse">Čakám na prvý SSE event…</p>
            )}
          </div>
        </>
      )}

      {/* Recent jobs */}
      {jobs.length > 0 && (
        <>
          <div className="border-t border-white/5" />
          <div className="flex flex-col gap-2">
            <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Nedávne úlohy</span>
            <div className="flex flex-col gap-1 max-h-44 overflow-y-auto pr-1">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  id={`forenzx-job-${job.id}`}
                  onClick={() => job.hub_job_id && setActiveJobId(job.hub_job_id)}
                  disabled={!job.hub_job_id}
                  className={[
                    "flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors text-left w-full",
                    "bg-white/5 border border-transparent hover:border-white/10",
                    job.hub_job_id === activeJobId ? "border-cyan-500/30 bg-cyan-500/5" : "",
                    !job.hub_job_id ? "opacity-50 cursor-not-allowed" : "",
                  ].join(" ")}
                  aria-label={`Zobraziť úlohu ${job.hub_job_id ?? job.id}`}
                >
                  <span className="font-mono text-zinc-300 truncate max-w-45">
                    {job.hub_job_id ?? job.id.slice(0, 8)}
                  </span>
                  <StatusBadge status={job.status} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
