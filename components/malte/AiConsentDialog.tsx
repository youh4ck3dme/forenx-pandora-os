import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AI_CONSENT_LABEL } from "@/lib/ai-consent";

type Props = {
  open: boolean;
  preview: string;
  providerName?: string;
  onDecision: (confirmed: boolean) => void;
};

/** Okno so súhlasom pred prvým odoslaním údajov prípadu do externej AI. */
export function AiConsentDialog({
  open,
  preview,
  providerName = "externému poskytovateľovi AI",
  onDecision,
}: Props) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDecision(false);
      }}
    >
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          onDecision(false);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-risk-medium" aria-hidden />
            Odoslanie údajov do AI
          </DialogTitle>
          <DialogDescription className="text-xs">
            Nasledujúce údaje odídu {providerName}. Pred odoslaním ich
            skontrolujte — po odoslaní ich už nemožno vziať späť.
          </DialogDescription>
        </DialogHeader>

        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl border border-border bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground">
          {preview}
        </pre>

        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            aria-label={AI_CONSENT_LABEL}
          />
          <span>{AI_CONSENT_LABEL}</span>
        </label>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onDecision(false)}
          >
            Zrušiť
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={!checked}
            onClick={() => onDecision(true)}
          >
            Odoslať do AI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
