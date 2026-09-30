"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { BRAND } from "@/config/brand";
import { ForenzXAnalysisPanel } from "@/components/features/forenzx/ForenzXAnalysisPanel";

export default function McpInfoPage() {
  return <McpInfo />;
}

const tools = [
  {
    name: "case_overview",
    detail: "Celkové rizikové skóre, súhrnné počty a top príznaky.",
  },
  { name: "list_alerts", detail: "Zoznam zistení s filtrom podľa závažnosti." },
  {
    name: "list_entities",
    detail: "Osoby a firmy vrátane indikátorov schránkovej firmy.",
  },
  {
    name: "analyze_entity",
    detail: "Detail subjektu: príznaky, transakcie, prepojenia.",
  },
  {
    name: "analyze_transaction",
    detail: "Pravidlá monitoringu pre konkrétnu transakciu.",
  },
  {
    name: "list_weapons",
    detail: "Register zbraní a zhody v databáze EUROPOL.",
  },
  {
    name: "network_analysis",
    detail: "Reťazce, cesty peňazí a cezhraničné koridory.",
  },
];

function McpInfo() {
  const [copied, setCopied] = useState(false);
  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/mcp` : "/mcp";

  const copyUrl = () => {
    void navigator.clipboard.writeText(endpoint);
    setCopied(true);
    toast.success("URL bola skopírovaná do schránky.");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PhoneFrame>
      <AppHeader title="Agentné API (MCP)" back />
      <Screen>
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Terminal className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Model Context Protocol
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Pripojte vašich AI agentov cez štandardné rozhranie MCP.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-accent/40 p-3">
            <code className="text-xs font-mono">{endpoint}</code>
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </Card>

        <SectionTitle>Dostupné nástroje MCP ({tools.length})</SectionTitle>
        <Card className="divide-y divide-border p-0">
          {tools.map((t) => (
            <div key={t.name} className="p-3">
              <p className="font-mono text-xs font-bold text-foreground">
                {t.name}
              </p>
              <p className="text-[11px] text-muted-foreground">{t.detail}</p>
            </div>
          ))}
        </Card>

        <SectionTitle>Živé prepojenie ForenZX MCP Hub</SectionTitle>
        <ForenzXAnalysisPanel />
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
