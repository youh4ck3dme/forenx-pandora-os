import type React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActiveCase } from "@/lib/hooks/useActiveCase";
import { createCase } from "@/lib/forza/case-data";

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Jediný formulár na založenie prípadu (používa ho obrazovka Prípady aj Sandbox).
 * Po úspechu sa nový prípad nastaví ako aktívny a otvorí sa Prehľad s voľbou
 * Autopilot vs Sandbox (nie slepý skok len do Sandboxu).
 */
export function NewCaseForm({
  withSubtitle = true,
  goToHub,
  goToSandbox,
  submitLabel = "Vytvoriť prípad",
  onCreated,
}: {
  withSubtitle?: boolean;
  goToHub?: boolean;
  /** @deprecated Alias — `false` vypne hub (zostáva na stránke). */
  goToSandbox?: boolean;
  submitLabel?: string;
  onCreated?: (caseId: string) => void;
}) {
  const shouldGoToHub = goToHub ?? goToSandbox ?? true;
  const { setActiveCaseId } = useActiveCase();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return; // ochrana proti dvojitému odoslaniu
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Zadajte názov prípadu.");
      return;
    }
    setBusy(true);
    try {
      const id = await createCase({
        name: trimmed,
        subtitle: withSubtitle ? subtitle.trim() : "Šifrovaný priestor prípadu",
      });
      setName("");
      setSubtitle("");
      // Najprv musí byť nový prípad v zozname, inak by ho kontext prepísal starým.
      await queryClient.refetchQueries({ queryKey: ["cases"] });
      setActiveCaseId(id);
      await queryClient.invalidateQueries({ queryKey: ["case", id] });
      onCreated?.(id);
      toast.success("Prípad vytvorený.");
      if (shouldGoToHub) {
        router.push("/forza/prehlad?start=1");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Prípad sa nepodarilo vytvoriť.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-2" onSubmit={handleSubmit}>
      <input
        id="new-case-input"
        aria-label="Názov prípadu"
        placeholder="Názov prípadu"
        className={inputClass}
        value={name}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
      />
      {withSubtitle ? (
        <input
          aria-label="Popis prípadu"
          placeholder="Krátky popis (nepovinné)"
          className={inputClass}
          value={subtitle}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSubtitle(event.target.value)}
        />
      ) : null}
      <Button type="submit" className="min-h-11 w-full" disabled={busy}>
        {busy ? "Vytváram…" : submitLabel}
      </Button>
    </form>
  );
}
