import type { SuspiciousFlowItem } from "../types";

export interface FinancialTransactionSummary {
  id: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  purpose: string;
  riskCategory: "safe" | "suspicious" | "critical";
  indicators: string[];
}

/**
 * Detekuje vzorce štruktúrovania vkladov (tzv. smurfing) – vklady tesne pod limitom nahlasovania (napr. 10 000 – 15 000 EUR).
 */
export function detectSmurfingPatterns(
  flows: SuspiciousFlowItem[],
): {
  isSmurfingDetected: boolean;
  totalSmurfedAmount: number;
  suspiciousDepositCount: number;
  details: string;
} {
  const structuredDeposits = flows.filter(
    (flow) =>
      flow.amount >= 5000 &&
      flow.amount < 15000 &&
      /vklad|hotovosť|pokladňa|atm/i.test(flow.purpose),
  );

  const totalSmurfedAmount = structuredDeposits.reduce(
    (sum, f) => sum + f.amount,
    0,
  );

  const isSmurfingDetected =
    structuredDeposits.length >= 3 || totalSmurfedAmount >= 30000;

  return {
    isSmurfingDetected,
    totalSmurfedAmount,
    suspiciousDepositCount: structuredDeposits.length,
    details: isSmurfingDetected
      ? `Zistených ${structuredDeposits.length} hotovostných vkladov v celkovej sume ${totalSmurfedAmount.toLocaleString("sk-SK")} EUR spĺňajúcich znaky smurfingu / štruktúrovania.`
      : "Žiadne zjavné znaky systematického štruktúrovania vkladov.",
  };
}

/**
 * Kategorizuje riziko finančnej transakcie na základe sumy, protistrany a účelu platby.
 */
export function categorizeTransactionRisk(flow: {
  amount: number;
  payer: string;
  recipient: string;
  purpose: string;
}): "safe" | "suspicious" | "critical" {
  const highRiskKeywords = /zbrane|munícia|faktúra|provízia|odmena|úplatok|tavira|armivex|veltra/i;
  const isHighValue = flow.amount >= 20000;
  const hasRiskKeyword = highRiskKeywords.test(flow.purpose);

  if (isHighValue && hasRiskKeyword) return "critical";
  if (isHighValue || hasRiskKeyword || flow.amount >= 10000) return "suspicious";
  return "safe";
}

/**
 * Agreguje finančné toky a vypočíta celkové objemy a identifikované rizikové toky.
 */
export function summarizeFinancialIntelligence(flows: SuspiciousFlowItem[]): {
  totalAnalyzedVolume: number;
  suspiciousCount: number;
  smurfingAnalysis: ReturnType<typeof detectSmurfingPatterns>;
  topCounterparties: string[];
} {
  const totalAnalyzedVolume = flows.reduce((sum, f) => sum + f.amount, 0);
  const smurfingAnalysis = detectSmurfingPatterns(flows);

  const counterpartiesCount = new Map<string, number>();
  for (const f of flows) {
    const cp = f.recipient || f.payer;
    if (cp) {
      counterpartiesCount.set(cp, (counterpartiesCount.get(cp) ?? 0) + f.amount);
    }
  }

  const topCounterparties = Array.from(counterpartiesCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amount]) => `${name} (${amount.toLocaleString("sk-SK")} EUR)`);

  return {
    totalAnalyzedVolume,
    suspiciousCount: flows.length,
    smurfingAnalysis,
    topCounterparties,
  };
}
