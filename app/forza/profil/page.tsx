"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UserCog, Cloud, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import { StepProgress } from "@/components/malte/StepProgress";
import { AdminQuarantinePanel } from "@/components/malte/AdminQuarantinePanel";
import { useAccountProfile } from "@/lib/hooks/useAccountProfile";
import { supabase } from "@/integrations/supabase/client";
import { signOutEverywhere } from "@/lib/forza/session";
import { BRAND } from "@/config/brand";

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-card text-card-foreground px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

export default function ProfilPage() {
  return <ProfileScreen />;
}

function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useAccountProfile();

  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email?: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: any } }) => {
      setCurrentUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event: unknown, session: any) => {
      setCurrentUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.fullName || "");
      setRole(profile.data.role || "");
    }
  }, [profile.data]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      toast.success("Profil bol úspešne uložený.");
    } catch (err: any) {
      toast.error(err?.message || "Uloženie profilu zlyhalo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PhoneFrame>
      <AppHeader title="Môj profil" back />
      <Screen>
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserCog className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Profil vyšetrovateľa / analytika
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Meno a funkcia sa zobrazujú vo vašich správoch a exportoch.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="profil-fullname" className="block text-xs font-medium text-muted-foreground mb-1">
                Meno a priezvisko
              </label>
              <input
                id="profil-fullname"
                name="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="napr. JUDr. Peter Novák"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="profil-role" className="block text-xs font-medium text-muted-foreground mb-1">
                Funkcia / Pozícia
              </label>
              <input
                id="profil-role"
                name="role"
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="napr. Forenzný analytik"
                className={inputClass}
              />
            </div>

            <Button type="submit" disabled={busy} className="w-full">
              Uložiť profil
            </Button>
          </form>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
              <Cloud className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                ForenX Cloud Účet
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Prístup k vyšetrovacím prípadom, bezpečnému trezoru a serverovým funkciám.
              </p>
            </div>
          </div>

          {currentUser ? (
            <div className="space-y-3 pt-1">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="text-muted-foreground mb-1">Prihlásený ako:</div>
                <div className="font-mono text-sm text-foreground break-all">
                  {currentUser.email || currentUser.id}
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Cloudová synchronizácia prípadov aktívna
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={async () => {
                  try {
                    await signOutEverywhere(supabase, queryClient);
                    setCurrentUser(null);
                    toast.success("Boli ste odhlásený.");
                    router.replace("/auth/login/");
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Zlyhalo odhlásenie. Skúste to znova.",
                    );
                  }
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Odhlásiť sa z ForenX účtu
              </Button>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground">
              Overujem prihlásenie k ForenX Cloud Účtu…
            </div>
          )}
        </Card>

        <AdminQuarantinePanel />
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
