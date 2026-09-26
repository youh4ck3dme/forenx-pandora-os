"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ShieldAlert, ShieldCheck } from "lucide-react";

import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND } from "@/config/brand";

export default function SukromiePage() {
  return <PrivacyScreen />;
}

function PrivacyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const data = { exportedAt: new Date().toISOString(), system: BRAND.name };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `forenx-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Vaše dáta boli úspešne vyexportované.");
    } catch {
      toast.error("Export dát zlyhal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PhoneFrame>
      <AppHeader title="Súkromie a ochranné prvky" />
      <Screen>
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Zabezpečenie & Súkromie dát
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Všetky spisy a analýzy zostávajú v šifrovanom priestore vášho prípadu.
              </p>
            </div>
          </div>
        </Card>

        <SectionTitle>Export a správa dát</SectionTitle>
        <Card className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Môžete si kedykoľvek vyexportovať kópiu svojich dát vo formáte JSON.
          </p>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={busy}
            className="w-full"
          >
            <Download className="mr-2 h-4 w-4" />
            Vyexportovať moje dáta (JSON)
          </Button>
        </Card>
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
