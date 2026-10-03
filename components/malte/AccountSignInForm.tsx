"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { adoptCloudSession } from "@/lib/forza/session";
import { setAuthCookies, syncSessionWithServer } from "@/lib/auth/cookies";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

type Mode = "signin" | "signup" | "reset";

/**
 * Prihlásenie, registrácia a obnova hesla pre účet ForenX. Po úspešnom
 * prihlásení sa lokálny stav vyčistí, aby sa práca dvoch identít nemiešala.
 */
export function AccountSignInForm({
  onSignedIn,
  dark = false,
  initialMode = "signin",
}: {
  onSignedIn?: () => void;
  dark?: boolean;
  initialMode?: Mode;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const fieldClass = dark
    ? "h-11 w-full rounded-xl border border-white/20 bg-black/50 px-3.5 text-sm text-white placeholder:text-slate-400 outline-none transition-all focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25"
    : inputClass;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const address = email.trim();
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw new Error("Obnovu hesla sa nepodarilo odoslať.");
        toast.success("Poslali sme vám e-mail na obnovu hesla.");
        setMode("signin");
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) {
          throw new Error(
            error.message.toLowerCase().includes("already")
              ? "Tento e-mail už má účet. Prihláste sa."
              : "Registrácia zlyhala. Skúste to znova.",
          );
        }
        if (!data.session) {
          toast.success(
            "Účet je vytvorený. Potvrďte ho, prosím, v e-maile a prihláste sa.",
          );
          setPassword("");
          setMode("signin");
          return;
        }
        setAuthCookies(data.session);
        await syncSessionWithServer(data.session);
        adoptCloudSession(queryClient);
        setPassword("");
        toast.success("Účet je vytvorený — ste prihlásený.");
        onSignedIn?.();
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: address,
        password,
      });
      if (error) throw new Error("Prihlásenie zlyhalo. Skontrolujte údaje.");
      if (data.session) {
        setAuthCookies(data.session);
        await syncSessionWithServer(data.session);
      }
      adoptCloudSession(queryClient);
      setPassword("");
      toast.success("Ste prihlásený — pracujete vo svojom účte.");
      onSignedIn?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Akcia zlyhala.");
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = busy
    ? "Pracujem…"
    : mode === "signup"
      ? "Vytvoriť účet"
      : mode === "reset"
        ? "Poslať odkaz na obnovu"
        : "Prihlásiť sa do účtu";

  const linkClass = dark
    ? "underline text-slate-300 hover:text-white transition-colors cursor-pointer text-xs"
    : "underline text-muted-foreground hover:text-foreground";

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="account-email" className="sr-only">
          E-mail účtu
        </label>
        <input
          id="account-email"
          name="email"
          aria-label="E-mail účtu"
          type="email"
          required
          autoComplete="username"
          className={fieldClass}
          placeholder="E-mail účtu"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {mode === "reset" ? null : (
        <div>
          <label htmlFor="account-password" className="sr-only">
            Heslo účtu
          </label>
          <input
            id="account-password"
            name="password"
            aria-label="Heslo účtu"
            type="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={fieldClass}
            placeholder={
              mode === "signup" ? "Nové heslo (min. 8 znakov)" : "Heslo účtu"
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      )}
      <Button
        type="submit"
        className={cn(
          "min-h-11 w-full font-bold transition-all active:scale-[0.99]",
          dark
            ? "bg-amber-400 text-slate-950 hover:bg-amber-300 shadow-md shadow-amber-400/20"
            : ""
        )}
        disabled={busy}
      >
        {submitLabel}
      </Button>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1 text-xs">
        {mode !== "signin" ? (
          <button
            type="button"
            className={linkClass}
            onClick={() => setMode("signin")}
          >
            Už mám účet — prihlásiť sa
          </button>
        ) : (
          <>
            <button
              type="button"
              className={linkClass}
              onClick={() => setMode("signup")}
            >
              Vytvoriť nový účet
            </button>
            <button
              type="button"
              className={linkClass}
              onClick={() => setMode("reset")}
            >
              Zabudnuté heslo
            </button>
          </>
        )}
      </div>
    </form>
  );
}
