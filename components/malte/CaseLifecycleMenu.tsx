import { useState } from "react";
import { Loader2, MoreHorizontal, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { CaseStatus, CaseSummary } from "@/lib/case-data";
import { destroyCase, setCaseStatus } from "@/lib/case-write.functions";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STATUS_LABEL: Record<CaseStatus, string> = {
  draft: "Draft",
  closed: "Uzavretý",
  legal_hold: "Legal Hold",
  archived: "Archivovaný",
  destroyed: "Zničený",
};

const STATUS_VARIANT: Record<CaseStatus, BadgeProps["variant"]> = {
  draft: "secondary",
  closed: "default",
  legal_hold: "destructive",
  archived: "outline",
  destroyed: "destructive",
};

type LifecycleAction = {
  target: CaseStatus;
  label: string;
  /** Vyžaduje odôvodnenie (legal hold, zničenie). */
  reason?: boolean;
  /** Vyžaduje potvrdenie v dialógu. */
  confirm?: boolean;
};

/** Povolené prechody zodpovedajú public.case_status_transition_ok v databáze. */
const ACTIONS: Record<Exclude<CaseStatus, "destroyed">, LifecycleAction[]> = {
  draft: [
    { target: "closed", label: "Uzavrieť prípad", confirm: true },
    {
      target: "legal_hold",
      label: "Nastaviť legal hold",
      reason: true,
      confirm: true,
    },
  ],
  closed: [
    { target: "draft", label: "Znova otvoriť" },
    {
      target: "legal_hold",
      label: "Nastaviť legal hold",
      reason: true,
      confirm: true,
    },
    { target: "archived", label: "Archivovať", confirm: true },
  ],
  legal_hold: [
    { target: "closed", label: "Zrušiť legal hold (iba admin)" },
    { target: "archived", label: "Archivovať", confirm: true },
  ],
  archived: [
    { target: "closed", label: "Znova otvoriť" },
    {
      target: "legal_hold",
      label: "Nastaviť legal hold",
      reason: true,
      confirm: true,
    },
    {
      target: "destroyed",
      label: "Zničiť prípad (iba admin)",
      reason: true,
      confirm: true,
    },
  ],
};

/**
 * Životný cyklus prípadu (P1-03): stav prípadu a prechody medzi stavmi.
 * Vynucovanie pravidiel robí databáza; tento komponent len ponúka
 * povolené akcie a odôvodnenie tam, kde ho audit vyžaduje.
 */
export function CaseLifecycleMenu({
  item,
  onChanged,
}: {
  item: CaseSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState("");

  function pick(action: LifecycleAction) {
    if (action.reason || action.confirm) {
      setReason("");
      setPending(action);
      return;
    }
    void run(action, "");
  }

  async function run(action: LifecycleAction, reasonText: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (action.target === "destroyed") {
        await destroyCase({ data: { id: item.id, reason: reasonText } });
        toast.success("Prípad bol kontrolovane zničený.");
      } else {
        await setCaseStatus({
          data: { id: item.id, status: action.target, reason: reasonText },
        });
        toast.success(`Stav prípadu: ${STATUS_LABEL[action.target]}.`);
      }
      setPending(null);
      onChanged();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Zmena stavu zlyhala.";
      toast.error(message, {
        action: { label: "Skúsiť znova", onClick: () => void run(action, reasonText) },
      });
    } finally {
      setBusy(false);
    }
  }

  const actions = ACTIONS[item.status as Exclude<CaseStatus, "destroyed">] ?? [];

  return (
    <>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Životný cyklus prípadu ${item.name}`}
              disabled={busy || actions.length === 0}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground disabled:opacity-50 cursor-pointer"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.target + action.label}
                onSelect={() => pick(action)}
              >
                {action.target === "destroyed" ? (
                  <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : null}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(nextOpen) => {
          if (!busy && !nextOpen) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? pending.label : ""}</DialogTitle>
            <DialogDescription>
              {pending?.target === "destroyed"
                ? "Zničenie je nevratné, vyžaduje administrátora a nezmeniteľne sa zaznamená do audit logu."
                : "Zmena stavu sa zaznamená do audit logu prípadu."}
            </DialogDescription>
          </DialogHeader>
          {pending?.reason ? (
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              Odôvodnenie
              <Input
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  pending.target === "legal_hold"
                    ? "Např. súdny príkaz, číslo spisu"
                    : "Právny základ zničenia (min. 10 znakov)"
                }
                aria-label="Odôvodnenie zmeny stavu"
              />
            </label>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Zrušiť
            </Button>
            <Button
              type="button"
              variant={
                pending?.target === "destroyed" || pending?.target === "legal_hold"
                  ? "destructive"
                  : "default"
              }
              disabled={
                busy ||
                (pending?.reason === true && reason.trim().length < 10)
              }
              onClick={() => pending && void run(pending, reason.trim())}
            >
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Potvrdiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
