import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { Card, SectionTitle } from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import { useActiveCase } from "@/hooks/useActiveCase";
import { createCase } from "@/lib/case-data";
import {
  getAdminQuarantineAccess,
  listQuarantineDocuments,
  type QuarantineListItem,
} from "@/lib/quarantine.functions";
import {
  writeQuarantineStage,
  type QuarantineStageTarget,
} from "@/lib/quarantine-stage";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function NewCaseInline({
  onCreated,
  disabled,
}: {
  onCreated: (id: string) => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.message("Zadajte názov nového prípadu.");
      return;
    }
    setBusy(true);
    try {
      const id = await createCase({
        name: trimmed,
        subtitle: "Quarantine import",
      });
      await queryClient.refetchQueries({ queryKey: ["cases"] });
      setName("");
      onCreated(id);
      toast.success("Prípad vytvorený.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Prípad sa nepodarilo vytvoriť.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 space-y-1">
        <span className="text-label">Alebo nový prípad</span>
        <input
          className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Názov prípadu"
          value={name}
          disabled={disabled || busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 shrink-0"
        disabled={disabled || busy || name.trim().length < 2}
        onClick={() => void handleCreate()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vytvoriť"}
      </Button>
    </div>
  );
}

export function AdminQuarantinePanel() {
  const router = useRouter();
  const { cases, activeCaseId, setActiveCaseId } = useActiveCase();
  const checkAccess = useServerFn(getAdminQuarantineAccess);
  const listDocs = useServerFn(listQuarantineDocuments);

  const [admin, setAdmin] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [files, setFiles] = useState<QuarantineListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caseId, setCaseId] = useState(activeCaseId ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await checkAccess();
        if (!alive) return;
        setAdmin(Boolean(res.admin));
      } catch {
        if (alive) setAdmin(false);
      } finally {
        if (alive) setAccessChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [checkAccess]);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    setLoadingList(true);
    void (async () => {
      try {
        const res = await listDocs();
        if (!alive) return;
        setFiles(res.files);
      } catch (err) {
        if (alive) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Nepodarilo sa načítať quarantine.",
          );
        }
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [admin, listDocs]);

  useEffect(() => {
    if (activeCaseId && !caseId) setCaseId(activeCaseId);
  }, [activeCaseId, caseId]);

  const selectedCount = selected.size;
  const selectedBytes = useMemo(() => {
    let sum = 0;
    for (const f of files) {
      if (selected.has(f.name)) sum += f.bytes;
    }
    return sum;
  }, [files, selected]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(files.map((f) => f.name)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function sendTo(target: QuarantineStageTarget) {
    if (selectedCount === 0) {
      toast.message("Vyberte aspoň jeden dokument.");
      return;
    }
    if (!caseId) {
      toast.message("Vyberte prípad, do ktorého dokumenty pôjdu.");
      return;
    }
    setBusy(true);
    try {
      setActiveCaseId(caseId);
      writeQuarantineStage({
        caseId,
        names: [...selected],
        target,
        createdAt: Date.now(),
      });
      const label = target === "sandbox" ? "AI Sandbox" : "Forenzný Autopilot";
      toast.success(`${selectedCount} dokumentov pripravených → ${label}`);
      if (target === "sandbox") {
        router.push(
          `/forza/sandbox?upload=1&case=${encodeURIComponent(caseId)}&quarantine=1`
        );
      } else {
        router.push(
          `/forza/asistent?case=${encodeURIComponent(caseId)}&quarantine=1`
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (!accessChecked || !admin) return null;

  return (
    <>
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5" aria-hidden />
          Admin · Quarantine sandbox
        </span>
      </SectionTitle>
      <Card className="space-y-3">
        <p className="text-[12px] text-muted-foreground">
          Citlivé dokumenty z lokálneho{" "}
          <code className="text-[11px]">quarantine/repo-root</code> (nie cloud
          Storage) — vyberte súbory a pošlite ich do Sandboxu (entity/kontroly)
          alebo Autopilota (forenzná analýza). Súbory sa do gitu necommitujú.
        </p>

        <label className="block space-y-1">
          <span className="text-label">Cieľový prípad</span>
          <select
            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            {cases.length === 0 ? (
              <option value="">
                Žiadny prípad — založte nižšie alebo v Prípadoch
              </option>
            ) : (
              cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))
            )}
          </select>
        </label>

        <NewCaseInline
          onCreated={(id) => {
            setCaseId(id);
            setActiveCaseId(id);
          }}
          disabled={busy}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={selectAll}
            disabled={files.length === 0 || busy}
          >
            Vybrať všetko
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9"
            onClick={clearSelection}
            disabled={selectedCount === 0 || busy}
          >
            Zrušiť výber
          </Button>
          <span className="self-center text-[11px] text-muted-foreground">
            {selectedCount > 0
              ? `${selectedCount} · ${formatBytes(selectedBytes)}`
              : "nič nevybrané"}
          </span>
        </div>

        {loadingList ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Načítavam quarantine…
          </div>
        ) : files.length === 0 ? (
          <p className="py-3 text-[12px] text-muted-foreground">
            V quarantine/repo-root nie sú žiadne podporované súbory (.md, .pdf,
            .txt, …).
          </p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border/60 p-2">
            {files.map((f) => {
              const on = selected.has(f.name);
              return (
                <li key={f.name}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      onChange={() => toggle(f.name)}
                      disabled={busy}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">
                        {f.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatBytes(f.bytes)} · {f.mime}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={busy || selectedCount === 0 || !caseId}
            onClick={() => void sendTo("sandbox")}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="mr-2 h-4 w-4" />
            )}
            Do Sandboxu
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full"
            disabled={busy || selectedCount === 0 || !caseId}
            onClick={() => void sendTo("asistent")}
          >
            Do Autopilota
          </Button>
        </div>
      </Card>
    </>
  );
}
