import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { describeDeleteImpact } from "@/lib/case-data";
import { deleteRecord } from "@/lib/case-write.functions";

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

  async function handleClick() {
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
      const warning = impact.cascades.length
        ? `Zmaže sa aj ${impact.cascades.join(", ")}. Pokračovať?`
        : `Naozaj zmazať ${label}?`;
      if (typeof window !== "undefined" && !window.confirm(warning)) return;
      await deleteRecord({ data: { type, id } });
      toast.success("Zmazané.");
      onDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mazanie zlyhalo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={`Zmazať ${label}`}
      disabled={busy}
      onClick={() => void handleClick()}
      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
