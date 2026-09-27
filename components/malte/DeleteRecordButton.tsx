import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { describeDeleteImpact } from "@/lib/case-data";
import { deleteRecord } from "@/lib/case-write.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type RecordType =
  "case" | "entity" | "transaction" | "relation" | "weapon" | "event";

/**
 * Mazanie so zobrazením dopadu. Ak na záznam odkazujú iné záznamy,
 * mazanie sa nevykoná — nevzniknú osirelé referencie.
 */
export function DeleteRecordButton({
  type,
  id,
  label,
  onDeleted,
}: {
  type: RecordType;
  id: string;
  label: string;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const requiresCaseName = type === "case";

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const impact = await describeDeleteImpact({ data: { type, id } });
      if (!impact.canDelete) {
        toast.error(
          `Nedá sa zmazať — odkazuje naň ${impact.blockers.join(", ")}.`,
        );
        return;
      }
      await deleteRecord({ data: { type, id } });
      toast.success("Zmazané.");
      onDeleted();
      setConfirmation("");
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mazanie zlyhalo.";
      toast.error(message, {
        action: { label: "Skúsiť znova", onClick: () => void handleDelete() },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) setOpen(nextOpen);
      }}
    >
      <button
        type="button"
        aria-label={`Zmazať ${label}`}
        disabled={busy}
        onClick={() => setOpen(true)}
        className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
      </button>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Zmazať {label}?</DialogTitle>
          <DialogDescription>
            Táto akcia je nevratná. Súvisiace záznamy sa pred zmazaním
            skontrolujú.
          </DialogDescription>
        </DialogHeader>
        {requiresCaseName ? (
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            Pre potvrdenie napíšte názov prípadu: <strong>{label}</strong>
            <input
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              aria-label={`Napíšte názov prípadu ${label}`}
            />
          </label>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Zrušiť
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || (requiresCaseName && confirmation !== label)}
            onClick={() => void handleDelete()}
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Zmazať
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
