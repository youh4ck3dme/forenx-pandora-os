import { CheckCircle2, Link2, LockKeyhole } from "lucide-react";
import type { CustodyLedgerEntry } from "@/lib/forza/types";

export function shortHash(hash: string, length = 10) {
  return hash.length <= length * 2 ? hash : `${hash.slice(0, length)}…${hash.slice(-length)}`;
}

export function hasLinkedIntegrity(entries: CustodyLedgerEntry[]) {
  return entries.every(
    (entry, index) => index === 0 || entry.prevHash === entries[index - 1]?.hash,
  );
}

const actionLabel: Record<CustodyLedgerEntry["action"], string> = {
  SEIZURE: "Zaistenie",
  TRANSFER: "Odovzdanie",
  ANALYSIS: "Analýza",
  STORAGE: "Archív",
  COURT_SUBMISSION: "Predloženie súdu",
};

export function CustodyLedgerViewer({
  entries,
}: {
  entries: CustodyLedgerEntry[];
}) {
  const verified = hasLinkedIntegrity(entries);
  return (
    <section className="space-y-3" aria-label="Dôkazný ledger">
      <div className={`flex items-center gap-2 rounded-xl border p-3 ${verified ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}>
        {verified ? <CheckCircle2 className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
        <div>
          <p className="text-xs font-bold tracking-wider">
            {verified ? "VERIFIED INTEGRITY" : "INTEGRITY BREAK DETECTED"}
          </p>
          <p className="text-[11px] opacity-90">
            {entries.length} {entries.length === 1 ? "blok" : "blokov"} kryptografickej reťaze
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          Reťaz zabezpečenia zatiaľ neobsahuje žiadne zaevidované úkony.
        </div>
      ) : (
        <ol className="space-y-0">
          {entries.map((entry, index) => (
            <li key={entry.id} className="relative pl-8 pb-4 last:pb-0">
              {index < entries.length - 1 ? (
                <span className="absolute left-[11px] top-6 h-[calc(100%-8px)] border-l border-dashed border-cyan-500/50" aria-hidden />
              ) : null}
              <span className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/50 bg-cyan-500/15 font-mono text-[10px] font-bold text-cyan-300">
                {entry.index}
              </span>
              <article className="rounded-xl border border-border bg-card text-card-foreground p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold">{actionLabel[entry.action]}</p>
                    <p className="text-[11px] text-muted-foreground">{entry.actor} · {entry.location}</p>
                  </div>
                  <time className="font-mono text-[10px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString("sk-SK")}
                  </time>
                </div>
                {entry.notes ? <p className="mt-2 text-xs text-muted-foreground">{entry.notes}</p> : null}
                <div className="mt-3 grid gap-1 font-mono text-[10px] sm:grid-cols-2">
                  <p className="rounded bg-muted/50 px-2 py-1 break-all">SHA {shortHash(entry.hash)}</p>
                  <p className="rounded bg-muted/50 px-2 py-1 break-all">PREV {shortHash(entry.prevHash)}</p>
                </div>
                <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                  <Link2 className="h-3 w-3" /> {entry.traceId} · payload {shortHash(entry.payloadHash, 6)}
                </p>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
