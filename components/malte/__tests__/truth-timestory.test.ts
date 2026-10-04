import { describe, expect, it } from "vitest";
import {
  buildDynamicAnomalies,
  buildDynamicEpisodes,
} from "@/components/malte/TruthTimestorySection";
import { EMPTY_CASE } from "@/lib/forza/forensic";
import type { ForensicDossier } from "@/lib/forza/types";

const dossier: ForensicDossier = {
  caseId: "case-dynamic",
  caseTitle: "Dynamický spis",
  defendabilityIndex: 50,
  generatedAt: "2026-09-27T00:00:00.000Z",
  facts: {
    timeline: [
      {
        time: "2026-09-01T10:00:00.000Z",
        event: "Zaistenie bankového výpisu",
        source: "Zápisnica č. 12",
        chainBreak: true,
        paragraph: "§ 119 TP",
      },
    ],
    traces: [],
  },
  defenseAttack: { overallRisk: "STREDNÉ", attacks: [] },
  evidenceStrength: { traces: [], paragraphs: [] },
  judgeReadyText: { skutkovyStav: "", vyporiadanie: "", vedecke: "" },
  testimonyContradictions: [
    {
      id: "TC-1",
      topic: "Rozpor vo výpovedi",
      personA: { name: "Svedok A", status: "svedok", claim: "Tvrdenie A" },
      factualRecord: "Listina tvrdenie nepotvrdzuje.",
      deceitPercentage: 65,
      contradictionSeverity: "high",
      proceduralResolution: "Vykonať konfrontáciu.",
    },
  ],
};

describe("TruthTimestorySection dynamic mapping", () => {
  it("builds episodes strictly from the active dossier timeline", () => {
    const episodes = buildDynamicEpisodes(
      { ...EMPTY_CASE, id: "case-dynamic", name: "Dynamický spis" },
      dossier,
    );

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      title: "Zaistenie bankového výpisu",
      forensicAnalysis: expect.stringContaining("Zápisnica č. 12"),
      debunkedLie: expect.stringContaining("§ 119 TP"),
    });
    expect(episodes[0]?.dialogues[0]?.text).toBe("Zaistenie bankového výpisu");
  });

  it("maps contradictions into case-specific forensic findings", () => {
    const anomalies = buildDynamicAnomalies(dossier);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      title: "Rozpor vo výpovedi",
      prosecutionClaim: "Tvrdenie A",
      forensicTruth: "Listina tvrdenie nepotvrdzuje.",
      proceduralAction: "Vykonať konfrontáciu.",
    });
  });
});
