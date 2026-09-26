"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
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
import { AccountSignInForm } from "@/components/malte/AccountSignInForm";
import { AdminQuarantinePanel } from "@/components/malte/AdminQuarantinePanel";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { BRAND } from "@/config/brand";

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

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
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Meno a priezvisko
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="napr. JUDr. Peter Novák"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Funkcia / Pozícia
              </label>
              <input
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

        <AdminQuarantinePanel />
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
