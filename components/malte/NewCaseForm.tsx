import type React from "react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveCase } from "@/lib/hooks/useActiveCase";
import { createCase } from "@/lib/forza/case-data";
import { isSessionExpiredError } from "@/lib/forza/session-expired";

const inputClass =
  "h-11 w-full rounded-xl border border-white/20 bg-black/60 backdrop-blur-md px-3.5 text-sm text-white placeholder:text-neutral-400 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25";

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
  const { setActiveCaseId, refresh } = useActiveCase();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Zadajte názov prípadu.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const id = await createCase({
        name: trimmed,
        subtitle: withSubtitle ? subtitle.trim() : "Šifrovaný priestor prípadu",
      });
      setName("");
      setSubtitle("");
      // Najprv musí byť nový prípad v zozname a v kontexte
      await refresh?.(id);
      setActiveCaseId(id);
      await queryClient.refetchQueries({ queryKey: ["cases"] });
      await queryClient.invalidateQueries({ queryKey: ["case", id] });
      onCreated?.(id);
      toast.success("Prípad vytvorený.");
      if (shouldGoToHub) {
        router.push("/forza/prehlad?start=1");
      }
    } catch (error) {
      if (isSessionExpiredError(error)) {
        toast.error("Relácia vypršala. Prihláste sa znova.", {
          action: {
            label: "Prihlásiť sa",
            onClick: () => router.push("/auth/login/"),
          },
        });
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "Prípad sa nepodarilo vytvoriť.";
      toast.error(message, {
        action: {
          label: "Skúsiť znova",
          onClick: () =>
            void handleSubmit({
              preventDefault: () => undefined,
            } as React.FormEvent),
        },
      });
    } finally {
      submitting.current = false;
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
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          setName(event.target.value)
        }
      />
      {withSubtitle ? (
        <input
          aria-label="Popis prípadu"
          placeholder="Krátky popis (nepovinné)"
          className={inputClass}
          value={subtitle}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setSubtitle(event.target.value)
          }
        />
      ) : null}
      <Button type="submit" className="min-h-11 w-full" disabled={busy}>
        {busy ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
        ) : null}
        {busy ? "Vytváram…" : submitLabel}
      </Button>
    </form>
  );
}
