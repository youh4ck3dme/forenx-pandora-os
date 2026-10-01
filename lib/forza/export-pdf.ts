import type { ForensicDossier } from "./types";
import { formatSourceRef } from "./types";
import { AI_DISCLAIMER } from "@/config/brand";

import { sha256Hex } from "./provenance/sha256";
import { canonicalSha256 } from "./provenance/canonical";
import { buildReportManifest, type ReportManifest } from "./provenance/report-manifest";
import { NO_BOUND_FACTS_TEXT, judgeNarrativeParts } from "./judge-text";
import {
  NO_VERIFIED_EVIDENCE,
  isFinancingConclusionBound,
  listBoundFacts,
  partitionAdmissibilityAudit,
  partitionAlternativeHypotheses,
  partitionDefenseAttacks,
  partitionEvidenceTraces,
  gatedInvestigativeAnswers,
  partitionLegalParagraphs,
  partitionSuspiciousFlows,
  partitionTimeline,
} from "./evidence-binding";

/** Issue #16: odpoveď bez väzby na dôkaz sa nevypisuje — menuje osoby. */
export const NO_BOUND_ANSWER_TEXT =
  "Odpoveď nie je viazaná na hash-overený dôkaz z WORM ledgera — odpoveď, menované osoby ani miera istoty sa neuvádzajú.";

/** Issue #16: záver o financovaní bez väzby na dôkaz sa nevypisuje. */
export const NO_BOUND_FINANCING_TEXT =
  "nie je viazaný na hash-overený dôkaz z WORM ledgera — neuvádza sa.";
import {
  buildInvestigatorSignature,
  type InvestigatorSignature,
  type WebauthnBinding,
} from "./investigator-signature";

export { sha256Hex };

/**
 * SHA-256 kanonickej serializácie dossieru (kontrola integrity obsahu).
 * Nie je to elektronický podpis ani pečať.
 */
export function computeDossierSha256(dossier: ForensicDossier): string {
  return canonicalSha256(dossier);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Hlboká kópia dossieru so všetkými reťazcami escapovanými pre HTML. Obsah
 * dossieru pochádza z AI a z textu spisu (nedôveryhodný vstup) — do reportu,
 * ktorý sa otvára v origine aplikácie, sa nesmie dostať ako značky/skripty.
 */
export function escapeDossierForHtml<T>(value: T): T {
  if (typeof value === "string") return escapeHtml(value) as T;
  if (Array.isArray(value)) return value.map((item) => escapeDossierForHtml(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, escapeDossierForHtml(v)]),
    ) as T;
  }
  return value;
}

/**
 * Report + reprodukovateľný manifest. `report_sha256` viaže presný HTML text,
 * `content_sha256` kanonický obsah dossieru.
 */
export function buildReportPackage(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string> = NO_VERIFIED_EVIDENCE,
): {
  html: string;
  manifest: ReportManifest;
  manifestSha256: string;
} {
  const html = buildReportHTML(dossier, knownEvidence);
  const meta = dossier.analysisMeta;
  const { manifest, manifestSha256 } = buildReportManifest({
    subjectId: dossier.caseId,
    reportText: html,
    content: dossier,
    rulesetVersion: meta?.promptVersion ?? "unknown",
    parserVersions: meta ? [`model:${meta.model}`] : [],
  });
  return { html, manifest, manifestSha256 };
}

/**
 * Vypočíta SHA-256 hash z vygenerovaného HTML textu posudku.
 */
export function computeReportSha256(html: string): string {
  return sha256Hex(html);
}

// ─── Export § 168 TP reportu do tlačiteľnej HTML → PDF ───────────

/** Manifest sa vkladá až za hashovaný text; pri overení sa tento blok odstráni. */
export const MANIFEST_MARKER = "<!--forenx-manifest-->";

export function withEmbeddedManifest(
  html: string,
  manifest: ReportManifest,
  manifestSha256: string,
): string {
  // "<" is escaped so the JSON can never close the <script> element.
  const json = JSON.stringify({ manifest, manifest_sha256: manifestSha256 })
    .replace(/</g, "\\u003c");
  const block = `${MANIFEST_MARKER}<script type="application/json" id="forenx-manifest">${json}</script>\n`;
  const at = html.lastIndexOf("</body>");
  return html.slice(0, at) + block + html.slice(at);
}

export function stripEmbeddedManifest(html: string): string {
  const start = html.indexOf(MANIFEST_MARKER);
  if (start < 0) return html;
  const end = html.indexOf("</script>\n", start) + "</script>\n".length;
  return html.slice(0, start) + html.slice(end);
}

/** Značka vloženého podpisového bloku; pri overení sa blok odstráni. */
export const SIGNATURE_MARKER = "<!--forenx-signature-->";

/**
 * Vloží viditeľný podpisový blok vyšetrovateľa (P1-01): identita,
 * UTC časová pečiatka, väzby na obsah (dossier/report/manifest) a
 * machine-readable JSON pre nezávislú verifikáciu hash-chainu.
 */
export function withEmbeddedSignature(
  html: string,
  signature: InvestigatorSignature,
): string {
  // "<" is escaped so the JSON can never close the <script> element.
  const json = JSON.stringify(signature).replace(/</g, "\\u003c");
  const block = `
<div class="integrity-section" id="forenx-signature-block">
  <h2>Digitálny podpis vyšetrovateľa (P1-01)</h2>
  <p><strong>${signature.investigatorName}</strong> (ID: <code>${signature.investigatorId}</code>)</p>
  <p>Čas podpisu (UTC): <strong>${signature.signedAt}</strong></p>
  <div class="hash-box"><p class="legal-expl">Viazané hashovacie väzby:</p>
    <p class="hash-code">dossier_sha256 = ${signature.dossierSha256}</p>
    <p class="hash-code">report_sha256 = ${signature.reportSha256}</p>
    <p class="hash-code">manifest_sha256 = ${signature.manifestSha256}</p>
    <p class="hash-code">signature_hash = ${signature.signatureHash}</p>
    <p class="hash-code">chain_hash = ${signature.chainHash}</p>
  </div>
  ${signature.webauthn ? `<p class="legal-expl">Viazané na WebAuthn kľúč <code>${signature.webauthn.credentialId}</code> (clientDataHash ${signature.webauthn.clientDataHash.slice(0, 16)}…).</p>` : ""}
  <p class="legal-expl">Podpis viaže presný text reportu (hash-chain). Akákoľvek následná zmena obsahu zneplatní verifikáciu.</p>
</div>
${SIGNATURE_MARKER}<script type="application/json" id="forenx-signature">${json}</script>
`;
  const at = html.lastIndexOf("</body>");
  return html.slice(0, at) + block + html.slice(at);
}

/** Odstráni vložený podpisový blok (pre nezávislú verifikáciu). */
export function stripEmbeddedSignature(html: string): string {
  const start = html.indexOf(SIGNATURE_MARKER);
  if (start < 0) return html;
  const signatureBlockStart = html.lastIndexOf('<div class="integrity-section" id="forenx-signature-block">', start);
  const begin = signatureBlockStart >= 0 ? signatureBlockStart : start;
  const scriptEnd = html.indexOf("</script>", start);
  if (scriptEnd < 0) return html;
  let end = scriptEnd + "</script>".length;
  if (html[end] === "\n") end += 1;
  let beginAt = begin;
  if (beginAt > 0 && html[beginAt - 1] === "\n") beginAt -= 1;
  return html.slice(0, beginAt) + html.slice(end);
}

export function exportDossierToPDF(
  dossier: ForensicDossier,
  options?: {
    /** Identita vyšetrovateľa; ak chýba, export bez podpisového bloku. */
    investigator?: { id: string; name: string };
    /** Voliteľná WebAuthn väzba na hardvérový kľúč. */
    webauthn?: WebauthnBinding;
    /** ID hash-overených dôkazov z WORM ledgera (useVerifiedEvidence); bez nich nie je nič viazané. */
    knownEvidence?: ReadonlySet<string>;
  },
): void {
  const pkg = buildReportPackage(dossier, options?.knownEvidence ?? NO_VERIFIED_EVIDENCE);
  // P1-01: podpis viaže presný (nepodpísaný) text reportu; blok sa
  // vloží pred manifest, aby stripEmbedded* revertovali presne tento text.
  const signedHtml = options?.investigator
    ? withEmbeddedSignature(
        pkg.html,
        buildInvestigatorSignature({
          investigatorId: options.investigator.id,
          investigatorName: options.investigator.name,
          caseId: dossier.caseId,
          dossierSha256: computeDossierSha256(dossier),
          reportSha256: computeReportSha256(pkg.html),
          manifestSha256: pkg.manifestSha256,
          reportText: pkg.html,
          webauthn: options.webauthn,
        }),
      )
    : pkg.html;
  const html = withEmbeddedManifest(signedHtml, pkg.manifest, pkg.manifestSha256);
  const win = window.open("", "_blank");
  if (!win) {
    alert("Povoľte vyskakovacie okná pre export reportu.");
    return;
  }

  win.document.write(html);
  win.document.close();

  setTimeout(() => {
    win.focus();
    win.print();
  }, 500);
}

/**
 * Stiahne manifest reportu ako JSON súbor pre nezávislé overenie (P4).
 *
 * Umožňuje vyšetrovateľovi overiť hash reportu externe bez závislosti
 * na aplikácii. Manifestový hash je kontrolný súčet — NIE je to dôkaz
 * pravdivosti tvrdení ani automatickej súdnej prípustnosti.
 */
export function downloadManifestJson(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string> = NO_VERIFIED_EVIDENCE,
): void {
  const { manifest, manifestSha256 } = buildReportPackage(dossier, knownEvidence);

  // Exportný objekt obsahuje manifest aj jeho hash pre nezávislé porovnanie.
  // UPOZORNENIE: Tento súbor overuje integritu (zhodu obsahu), nie pravdivosť
  // tvrdení ani súdnu prípustnosť dôkazov.
  const exportObj = {
    _disclaimer:
      "Tento manifest overuje integritu (zhodu obsahu) reportu — NIE pravdivosť tvrdení, " +
      "ani súdnu prípustnosť dôkazov. SHA-256 hash nie je elektronický podpis ani pečať.",
    manifest_sha256: manifestSha256,
    manifest,
  };

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeId = (dossier.caseId ?? "export").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  a.download = `forenx-manifest-${safeId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildReportHTML(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string> = NO_VERIFIED_EVIDENCE,
): string {
  // Hash z pôvodného obsahu; do HTML ide výhradne escapovaná kópia.
  const dossierHash = computeDossierSha256(dossier);
  const d = escapeDossierForHtml(dossier);

  // Task 4: faktom je iba udalosť viazaná na hash-overený dôkaz z WORM ledgera.
  const timeline = partitionTimeline(d, knownEvidence);
  const timelineHtml =
    timeline.bound.length > 0
      ? `
  <h2>Chronológia skutkov (zdrojované udalosti)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:14%">Čas</th>
        <th style="width:46%">Udalosť</th>
        <th style="width:40%">Zdroj (dokument · strana · výňatok)</th>
      </tr>
    </thead>
    <tbody>
      ${timeline.bound
        .map((ev) => {
          const src = formatSourceRef(ev.sourceRef) || ev.source?.trim() || "—";
          return `
        <tr>
          <td>${ev.time}</td>
          <td>${ev.event}</td>
          <td><code>${src}</code></td>
        </tr>`;
        })
        .join("")}
    </tbody>
  </table>`
      : "";

  // P1-01: nezdrojované okolnosti sa neexportujú ako fakt — iba ako
  // explicitne označená sekcia mimo skutkovej chronológie.
  const unboundTimelineHtml =
    timeline.unbound.length > 0
      ? `
  <h2>Nezdrojované okolnosti (bez opory v dôkazoch — nie sú skutkom)</h2>
  <p class="legal-expl">Nasledujúce okolnosti sa nepodarilo viazať na konkrétny dôkaz evidovaný v spise (§ 119 TP); nie sú súčasťou zisteného skutkového stavu.</p>
  <table>
    <thead>
      <tr>
        <th style="width:14%">Čas</th>
        <th style="width:46%">Udalosť</th>
        <th style="width:40%">Poznámka</th>
      </tr>
    </thead>
    <tbody>
      ${timeline.unbound
        .map((ev) => {
          return `
        <tr>
          <td>${ev.time}</td>
          <td>${ev.event}</td>
          <td><code>bez viazania na dôkaz</code></td>
        </tr>`;
        })
        .join("")}
    </tbody>
  </table>`
      : "";

  // Issue #13: do záverov II. a III. idú iba body obhajoby a stopy viazané na
  // hash-overený dôkaz; neviazané sa vypíšu len medzi neoverenými tvrdeniami.
  const traces = partitionEvidenceTraces(d, knownEvidence);
  const attacks = partitionDefenseAttacks(d, knownEvidence);
  const legalParagraphs = partitionLegalParagraphs(d, knownEvidence);

  const tracesRows = traces.bound
    .map((t) => {
      const src = formatSourceRef(t.sourceRef) || "—";
      return `
    <tr>
      <td><code>${t.id}</code></td>
      <td><strong>${t.name}</strong></td>
      <td style="text-align:center;font-weight:bold">${t.lr}</td>
      <td style="text-align:center">${strengthEmoji(t.light)}</td>
      <td>${t.strength}</td>
      <td>${t.paragraph}</td>
      <td><code>${src}</code></td>
    </tr>`;
    })
    .join("");

  const attacksHtml = attacks.bound
    .map((a) => {
      const src = formatSourceRef(a.sourceRef);
      return `
    <div class="attack">
      <p class="attack-claim"><strong>Tvrdenie obhajoby:</strong> ${a.defenseClaim}</p>
      <p class="attack-counter"><strong>Protiúder zo spisu:</strong> ${a.counterStrike}</p>
      <p class="attack-gap"><em>Identifikovaná medzera:</em> ${a.evidenceGap} — <strong class="badge-risk">Riziko: ${a.risk}</strong></p>
      ${src ? `<p class="attack-src" style="font-size:9pt;color:#475569"><strong>Zdroj:</strong> <code>${src}</code></p>` : ""}
    </div>`;
    })
    .join("");

  // Issue #16: odpoveď menuje osoby — bez väzby na overený dôkaz sa nevypíše
  // ani odpoveď, ani mená, ani miera istoty (ani medzi neoverenými tvrdeniami).
  // Otázka má vždy kanonické znenie — text otázky od modelu sa nevypisuje.
  const questionCards = gatedInvestigativeAnswers(d, knownEvidence)
    .map(({ number, question, answer: q, bound }) =>
      bound
        ? `
    <div class="question-card">
      <h3>${number}. ${question}</h3>
      <p>${q.answer}</p>
      <p class="question-meta"><strong>Identifikované osoby:</strong> ${q.identifiedPersons.join(", ")} · <strong>Miera istoty:</strong> ${q.confidenceLevel} % · <strong>Zdroj:</strong> <code>${formatSourceRef(q.sourceRef)}</code></p>
    </div>`
        : `
    <div class="question-card">
      <h3>${number}. ${question}</h3>
      <p class="legal-expl">${NO_BOUND_ANSWER_TEXT}</p>
    </div>`,
    )
    .join("");
  const questionsHtml = questionCards
    ? `
  <h2>Záväzný analytický rámec ÚBOK (3 vyšetrovacie otázky — Source of Truth)</h2>
  <div class="section">${questionCards}
  </div>`
    : "";

  const contradictionsHtml =
    d.testimonyContradictions && d.testimonyContradictions.length > 0
      ? `
  <h2>Rozpory vo výpovediach & Matica pravdovravnosti (§ 125 TP — Konfrontácia)</h2>
  <p class="legal-expl">
    V zmysle <strong>§ 125 Trestného poriadku</strong>, ak sa výpovede obvinených alebo svedkov v závažných okolnostiach nezhodujú, vykoná sa konfrontácia alebo opakovaný výsluch. Nasledujúca matica zachytáva identifikované skutkové protirečenia, kvantifikovanú mieru nepravdy a navrhovaný procesný postup OČTK:
  </p>
  <table>
    <thead>
      <tr>
        <th style="width:17%">Téma rozporu</th>
        <th style="width:28%">Výpoveď v konaní</th>
        <th style="width:27%">Objektívny skutkový stav zo spisu</th>
        <th style="width:10%;text-align:center">Miera nepravdy</th>
        <th style="width:18%">Procesný postup (§ 125 TP)</th>
      </tr>
    </thead>
    <tbody>
      ${d.testimonyContradictions
        .map(
          (tc) => `
        <tr>
          <td><strong>${tc.topic}</strong></td>
          <td><em>${tc.personA.name} (${tc.personA.status}):</em> „${tc.personA.claim}“</td>
          <td>${tc.factualRecord}</td>
          <td style="text-align:center;font-weight:bold;color:${tc.deceitPercentage >= 75 ? "#dc2626" : "#d97706"}">${tc.deceitPercentage} %</td>
          <td>${tc.proceduralResolution}</td>
        </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : "";

  const flows = partitionSuspiciousFlows(d, knownEvidence);
  const financialHtml = d.financialAnalysis
    ? `
  <h2>Forenzná analýza transakcií a tokov financií (§ 119 ods. 1 písm. f) TP)</h2>
  <div class="section">
    <p><strong>Celkový objem:</strong> ${d.financialAnalysis.totalVolume.toLocaleString("sk-SK")} € · <strong>Hotovosť:</strong> ${d.financialAnalysis.cashVolume.toLocaleString("sk-SK")} € (${d.financialAnalysis.cashRatioPercent} %) · <strong>Prevody:</strong> ${d.financialAnalysis.transferVolume.toLocaleString("sk-SK")} €</p>
    ${
      isFinancingConclusionBound(d, knownEvidence)
        ? `<p><em>Záver o financovaní:</em> ${d.financialAnalysis.financingConclusion} <em>(zdroj: <code>${formatSourceRef(d.financialAnalysis.sourceRef)}</code>)</em></p>`
        : `<p class="legal-expl"><em>Záver o financovaní:</em> ${NO_BOUND_FINANCING_TEXT}</p>`
    }
    <h3>Podozrivé finančné toky a platobné operácie</h3>
    <table>
      <thead>
        <tr>
          <th style="width:12%">Dátum</th>
          <th style="width:28%">Platiteľ ➔ Príjemca</th>
          <th style="width:15%;text-align:right">Suma</th>
          <th style="width:15%;text-align:center">Forma platby</th>
          <th style="width:22%">Účel platby & Forenzný indikátor (Red Flag)</th>
          <th style="width:8%">Zdroj (P1-01)</th>
        </tr>
      </thead>
      <tbody>
        ${flows.bound
          .map(
            (sf) => `
          <tr>
            <td>${sf.date}</td>
            <td>${sf.payer} ➔ ${sf.recipient}</td>
            <td style="text-align:right;font-weight:bold">${sf.amount.toLocaleString("sk-SK")} €</td>
            <td style="text-align:center">${sf.method}</td>
            <td><strong>${sf.purpose}</strong>: ${sf.redFlag}</td>
            <td><code>${formatSourceRef(sf.sourceRef)}</code></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
    ${flows.unbound.length > 0
      ? `
    <h3>Toky bez viazania na dôkaz (neoverené — nie sú skutkom)</h3>
    <table>
      <thead>
        <tr>
          <th style="width:14%">Dátum</th>
          <th style="width:34%">Platiteľ ➔ Príjemca</th>
          <th style="width:16%;text-align:right">Suma</th>
          <th style="width:36%">Poznámka</th>
        </tr>
      </thead>
      <tbody>
        ${flows.unbound
          .map(
            (sf) => `
        <tr>
          <td>${sf.date}</td>
          <td>${sf.payer} ➔ ${sf.recipient}</td>
          <td style="text-align:right">${sf.amount.toLocaleString("sk-SK")} €</td>
          <td>${sf.purpose} — <code>bez viazania na dôkaz</code></td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
      : ""}
  </div>`
    : "";

  const hypotheses = partitionAlternativeHypotheses(
    d.alternativeHypotheses,
    knownEvidence,
  );
  const admissibility = partitionAdmissibilityAudit(
    d.admissibilityAudit,
    knownEvidence,
  );
  const sourceLabel = (ref: {
    evidenceId: string;
    page?: number;
    paragraph?: string;
  }) =>
    `${ref.evidenceId}${ref.page ? ` · s.${ref.page}` : ""}${ref.paragraph ? ` · ${ref.paragraph}` : ""}`;
  const hypothesesHtml =
    hypotheses.bound.length > 0
      ? `
  <h2>Alternatívne hypotézy viazané na dôkazy</h2>
  ${hypotheses.bound
    .map(
      (hypothesis) => `
    <div class="section">
      <h3>${hypothesis.title}</h3>
      <p>${hypothesis.scenario}</p>
      <p><strong>Zdroj:</strong> ${hypothesis.sourceReferences!
        .map((ref) => sourceLabel(ref))
        .join("; ")}</p>
    </div>`,
    )
    .join("")}`
      : "";
  const admissibilityHtml =
    admissibility.summaryBound || admissibility.boundDefects.length > 0
      ? `
  <h2>Audit procesnej prípustnosti (§ 119 TP) — zdrojované posúdenie</h2>
  ${
    admissibility.summaryBound && d.admissibilityAudit
      ? `<p><strong>Stav:</strong> ${d.admissibilityAudit.status} · <strong>Skóre:</strong> ${d.admissibilityAudit.score}%</p>
  <p>${d.admissibilityAudit.courtReadySummary}</p>
  <p><strong>Zdroje:</strong> ${d.admissibilityAudit.sourceReferences!
    .map((ref) => sourceLabel(ref))
    .join("; ")}</p>`
      : ""
  }
  ${admissibility.boundDefects
    .map(
      (defect) => `
    <div class="section">
      <h3>${defect.paragraph} — ${defect.severity}</h3>
      <p>${defect.description}</p>
      <p><strong>Náprava:</strong> ${defect.remedyAction}</p>
      <p><strong>Zdroj:</strong> ${sourceLabel(
        defect.sourceRef ?? {
          evidenceId: defect.sourceEvidenceId!,
          ...(defect.sourcePage ? { page: defect.sourcePage } : {}),
          ...(defect.sourceParagraph
            ? { paragraph: defect.sourceParagraph }
            : {}),
        },
      )}</p>
    </div>`,
    )
    .join("")}`
      : "";
  const unverifiedClaims = [
    ...hypotheses.unbound.map(
      (hypothesis) =>
        `<strong>${hypothesis.title}:</strong> ${hypothesis.scenario} <em>(chýba platná väzba na existujúci dôkaz a stranu alebo odsek)</em>`,
    ),
    ...(!admissibility.summaryBound && d.admissibilityAudit
      ? [
          `<strong>§ 119 TP — celkový audit (${d.admissibilityAudit.status}, ${d.admissibilityAudit.score}%):</strong> ${d.admissibilityAudit.courtReadySummary} <em>(bez platnej väzby na dôkaz)</em>`,
        ]
      : []),
    ...admissibility.unboundDefects.map(
      (defect) =>
        `<strong>${defect.paragraph}:</strong> ${defect.description} <em>(vadu sa nepodarilo viazať na existujúci dôkaz a stranu alebo odsek)</em>`,
    ),
    ...attacks.unbound.map(
      (a) =>
        `<strong>Bod obhajoby (${a.risk}):</strong> ${a.defenseClaim} — navrhovaný protiúder: ${a.counterStrike} <em>(bez platnej väzby na dôkaz)</em>`,
    ),
    ...traces.unbound.map(
      (t) =>
        `<strong>Stopa ${t.id} — ${t.name}:</strong> LR ${t.lr}, ${t.strength} <em>(hodnotenie stopy bez platnej väzby na dôkaz)</em>`,
    ),
    ...legalParagraphs.unbound.map(
      (p) =>
        `<strong>${p.para} — ${p.title} (${p.status}):</strong> ${p.note} <em>(posúdenie zákonného znaku bez platnej väzby na dôkaz)</em>`,
    ),
  ];
  const unverifiedClaimsHtml =
    unverifiedClaims.length > 0
      ? `
  <h2>Neoverené tvrdenia (nie sú skutkom)</h2>
  <p class="legal-expl">Nasledujúce hypotézy, posúdenia, body obhajoby a hodnotenia stôp nemajú platný odkaz na existujúce evidence_id a konkrétnu stranu alebo odsek; nesmú sa považovať za skutkové zistenia.</p>
  <ul>${unverifiedClaims.map((claim) => `<li>${claim}</li>`).join("")}</ul>`
      : "";

  // Issue #13: číslované závery (I.–III.) sa skladajú výlučne z tvrdení
  // viazaných na hash-overený dôkaz; naratív modelu (judgeReadyText) sa nikdy
  // nevypisuje ako skutkový záver.
  const boundFacts = listBoundFacts(d, knownEvidence);
  const boundFactsHtml =
    boundFacts.length > 0
      ? `<p class="legal-expl">Skutkový stav tvoria výlučne okolnosti viazané na hash-overený dôkaz z WORM ledgera (evidence_id a strana alebo odsek).</p>
  <ul>${boundFacts
    .map(
      (fact) =>
        `<li><strong>${fact.when}:</strong> ${fact.text} <em>(zdroj: <code>${fact.source}</code>)</em></li>`,
    )
    .join("")}</ul>`
      : `<p class="legal-expl">${NO_BOUND_FACTS_TEXT}</p>`;

  const narrativeParts = judgeNarrativeParts(d);
  const narrativeDraftHtml =
    narrativeParts.length > 0
      ? `
  <h2>AI návrh textu odôvodnenia (neoverený — nie je súčasťou záverov)</h2>
  <p class="legal-expl">Voľný text vygenerovaný modelom bez väzby na konkrétne dôkazy. Môže obsahovať neoverené tvrdenia; do záverov I.–III. sa nepreberá a pred akýmkoľvek použitím musí byť overený voči originálu spisu.</p>
  ${narrativeParts
    .map(
      (part) => `
  <div class="section">
    <h3>${part.label} — návrh</h3>
    <p>${part.text}</p>
  </div>`,
    )
    .join("")}`
      : "";

  return `<!DOCTYPE html>
<html lang="sk">
<head>
<meta charset="UTF-8">
<title>AI pracovná analýza — ${d.caseTitle}</title>
<style>
  @page { margin: 2cm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11pt; line-height: 1.5; color: #111827; margin: 0; padding: 20px; }
  .court-header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
  .court-agency { font-size: 10pt; font-weight: bold; letter-spacing: 1px; color: #475569; text-transform: uppercase; margin-bottom: 4px; }
  h1 { font-size: 16pt; margin: 6px 0; color: #0f172a; text-transform: uppercase; }
  h2 { font-size: 12.5pt; margin-top: 22px; margin-bottom: 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; color: #0f172a; }
  h3 { font-size: 10.5pt; margin-top: 14px; margin-bottom: 6px; color: #334155; }
  .meta { text-align: center; font-size: 9.5pt; color: #475569; margin-bottom: 18px; line-height: 1.6; }
  .meta-hash code { font-family: "Courier New", monospace; font-size: 8.5pt; background: #f1f5f9; padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 3px; }
  .index-box { background: #f8fafc; border: 1.5px solid #3b82f6; border-radius: 4px; padding: 12px; margin: 16px 0; text-align: center; }
  .index-box p { margin: 2px 0; font-size: 10pt; }
  .index-box .num { font-size: 26pt; font-weight: bold; color: ${d.defendabilityIndex >= 75 ? "#16a34a" : d.defendabilityIndex >= 50 ? "#d97706" : "#dc2626"}; }
  .legal-expl { font-size: 9.5pt; color: #475569; font-style: italic; margin: 4px 0 10px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #94a3b8; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: bold; color: #0f172a; }
  .question-card { background: #f8fafc; border-left: 4px solid #2563eb; padding: 8px 12px; margin: 8px 0; }
  .question-card h3 { margin: 2px 0 4px 0; font-size: 10.5pt; color: #1e3a8a; }
  .question-card p { margin: 4px 0; font-size: 10pt; }
  .question-meta { font-size: 9pt; color: #64748b; margin-top: 4px !important; }
  .attack { border-left: 3px solid #dc2626; padding: 8px 12px; margin: 8px 0; background: #fff5f5; page-break-inside: avoid; }
  .attack-claim { color: #991b1b; margin: 2px 0; font-size: 10pt; }
  .attack-counter { color: #166534; margin: 2px 0; font-size: 10pt; }
  .attack-gap { font-size: 9pt; color: #64748b; margin: 4px 0 0 0; }
  .badge-risk { color: #b91c1c; }
  .section { margin: 14px 0; }
  .integrity-section { margin-top: 30px; border: 1.5px solid #0f172a; background: #fbfcfe; padding: 14px 18px; border-radius: 4px; page-break-inside: avoid; }
  .integrity-section h2 { border-bottom: none; margin-top: 0; padding-bottom: 0; font-size: 12pt; text-transform: uppercase; color: #0f172a; }
  .hash-box { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 12px; border-radius: 3px; margin: 8px 0; }
  .hash-code { font-family: "Courier New", monospace; font-size: 9pt; font-weight: bold; color: #0f172a; word-break: break-all; }
  .legal-clause { font-size: 9pt; line-height: 1.5; color: #334155; margin: 8px 0 14px 0; text-align: justify; }
  .signature-grid { display: flex; justify-content: space-between; margin-top: 35px; }
  .sig-block { width: 45%; text-align: center; }
  .sig-line { border-bottom: 1px solid #475569; margin-bottom: 6px; height: 35px; }
  .sig-block p { margin: 0; font-size: 8.5pt; color: #64748b; text-transform: uppercase; }
  .footer { margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 8.5pt; color: #64748b; text-align: center; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
    .index-box, .question-card, .attack, .integrity-section { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="court-header">
  <div class="court-agency">Prezídium Policajného zboru · Úrad boja proti organizovanej kriminalite</div>
  <h1>FORENZNÝ REPORT — ${d.caseTitle}</h1>
  <div class="meta">
    Spisová značka / ČVS: <strong>${d.caseId}</strong> · Dátum analýzy: <strong>${new Date(d.analysisMeta?.createdAt ?? d.generatedAt).toLocaleString("sk-SK")}</strong><br>
    Procesný formát: <strong>§ 142–147 TP (Odborné vyjadrenie) & § 168 TP (Odôvodnenie — AI pracovný návrh)</strong><br>
    ${
      d.analysisMeta
        ? `Model: <strong>${d.analysisMeta.model}</strong> · Prompt: <strong>${d.analysisMeta.promptVersion}</strong> · Stav: <strong>${d.analysisMeta.analysisStatus}</strong><br>
    Dokumenty: <strong>${(d.analysisMeta.documentIds ?? []).join(", ") || "—"}</strong><br>
    ${
      d.analysisMeta.truncation.truncated
        ? `Upozornenie na skrátenie: analyzovaných ${d.analysisMeta.truncation.analyzedChars} z ${d.analysisMeta.truncation.inputChars} znakov (${d.analysisMeta.truncation.chunkCount} častí).<br>`
        : ""
    }`
        : ""
    }
    <span class="meta-hash">Kryptografický odtlačok spisu (SHA-256): <code>${dossierHash}</code></span>
  </div>
</div>

<div class="ai-disclaimer" style="margin:10px 0;padding:8px 10px;border:1px solid #b45309;background:#fef3c7;color:#7c2d12;font-size:9pt;font-weight:600;">
  ${AI_DISCLAIMER}
  ${d.analysisMeta?.isDemo ? " Toto je SYNTETICKÁ UKÁŽKA — fiktívne údaje." : ""}
</div>

${
  (d.analysisMeta?.sourceReferences?.length ?? 0) > 0
    ? `<div class="section" style="font-size:9pt;color:#475569;margin:8px 0;">
  <strong>Zdroje uvedené v analýze</strong>
  <span style="font-weight:400"> (dokument · strana · úryvok, ak je k dispozícii):</span>
  <ul>${d
    .analysisMeta!.sourceReferences.slice(0, 40)
    .map((s) => `<li>${s}</li>`)
    .join("")}</ul>
</div>`
    : ""
}


<div class="index-box">
  <p><strong>Index obhájiteľnosti obžaloby pred súdom</strong></p>
  <span class="num">${d.defendabilityIndex}/100</span>
  <p style="font-size:9pt;color:#64748b">Kvantitatívny indikátor nepriestrelnosti dôkazov pred súdom Slovenskej republiky</p>
</div>

${questionsHtml}

${timelineHtml}
${unboundTimelineHtml}

${contradictionsHtml}

${financialHtml}

${hypothesesHtml}

${admissibilityHtml}

${unverifiedClaimsHtml}

${narrativeDraftHtml}

<h2>I. Zistený skutkový stav (§ 119 ods. 1 Trestného poriadku)</h2>
<div class="section">
  ${boundFactsHtml}
</div>

<h2>II. Vyporiadanie sa s obhajobou obvineného (§ 168 TP)</h2>
<div class="section">
  <h3>Identifikované body útoku obhajoby a dôkazné protiúdery:</h3>
  ${attacksHtml || `<p class="legal-expl">Žiadny bod obhajoby nie je viazaný na hash-overený dôkaz — neoverené body sú uvedené medzi neoverenými tvrdeniami.</p>`}
</div>

<h2>III. Vedecké zhodnotenie stôp</h2>
<div class="section">
  <h3>Dôkazová matica stôp (§ 119 ods. 2 TP & ENFSI metodika)</h3>
  <table>
    <thead>
      <tr>
        <th style="width:10%">Ev. č.</th>
        <th style="width:22%">Dôkazný prostriedok / Stopa</th>
        <th style="width:12%;text-align:center">LR</th>
        <th style="width:10%;text-align:center">Reťazec</th>
        <th style="width:12%">Sila</th>
        <th style="width:12%">Ustanovenie</th>
        <th style="width:22%">Zdroj</th>
      </tr>
    </thead>
    <tbody>${tracesRows || `<tr><td colspan="7"><em>Žiadna stopa nie je viazaná na hash-overený dôkaz — neoverené hodnotenia stôp sú uvedené medzi neoverenými tvrdeniami.</em></td></tr>`}</tbody>
  </table>
</div>

<h2>IV. Právna kvalifikácia a stav zákonných znakov (§ 294 TZ, § 138 TZ)</h2>
<table>
  <thead>
    <tr>
      <th style="width:14%">Zákonné ust.</th>
      <th style="width:28%">Názov skutkovej podstaty</th>
      <th style="width:14%;text-align:center">Stav naplnenia</th>
      <th style="width:44%">Dôkazné vyhodnotenie a skutkový základ</th>
    </tr>
  </thead>
  <tbody>
    ${d.evidenceStrength.paragraphs
      .map((p) =>
        legalParagraphs.bound.includes(p)
          ? `
      <tr>
        <td><strong>${p.para}</strong></td>
        <td>${p.title}</td>
        <td style="text-align:center;font-weight:bold;color:${p.status === "OK" ? "#16a34a" : p.status === "Narušené" ? "#dc2626" : "#d97706"}">${p.status}</td>
        <td>${p.note} <em>(zdroj: <code>${formatSourceRef(p.sourceRef)}</code>)</em></td>
      </tr>`
          : `
      <tr>
        <td><strong>${p.para}</strong></td>
        <td>${p.title}</td>
        <td style="text-align:center;font-weight:bold;color:#64748b">Neoverené</td>
        <td><em>Posúdenie nie je viazané na hash-overený dôkaz — uvedené medzi neoverenými tvrdeniami.</em></td>
      </tr>`,
      )
      .join("")}
  </tbody>
</table>

<div class="integrity-section">
  <h2>V. Kontrola integrity obsahu</h2>
  <div class="hash-box">
    <div style="font-size:9pt;color:#475569;margin-bottom:2px">SHA-256 kanonického obsahu analýzy (kontrola integrity, nie elektronický podpis ani pečať):</div>
    <div class="hash-code">${dossierHash}</div>
  </div>
  <p class="legal-clause">
    <strong>Doložka AI pôvodu:</strong> Tento dokument je AI pracovná analýza spisu ČVS: <strong>${d.caseId}</strong>, nie znalecký posudok ani rozhodnutie súdu.
    SHA-256 odtlačok viaže obsah analýzy, z ktorého bol report vytvorený; report nie je elektronicky podpísaný ani zapečatený; každý dátum, suma, osoba a citácia musia byť overené voči originálu spisu pred použitím v konaní (§ 119 TP).
    ${d.analysisMeta ? `Prompt ${d.analysisMeta.promptVersion}, model ${d.analysisMeta.model}.` : ""}
  </p>
  <div class="signature-grid">
    <div class="sig-block">
      <div class="sig-line"></div>
      <p>Forenzný analytik / OČTK ÚBOK PZ</p>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <p>Dozorujúci prokurátor / Predseda senátu</p>
    </div>
  </div>
</div>

<div class="footer">
  Forenzný Autopilot v1.0 · Vygenerované v súlade s § 142–147 a § 168 Trestného poriadku Slovenskej republiky.
</div>

<div class="no-print" style="text-align:center;margin-top:24px">
  <button onclick="window.print()" style="padding:10px 28px;font-size:12pt;font-weight:bold;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer">Tlačiť / Uložiť AI pracovnú analýzu ako PDF</button>
</div>

</body>
</html>`;
}

function strengthEmoji(light: string): string {
  if (light === "green") return "🟢";
  if (light === "yellow") return "🟡";
  if (light === "red") return "🔴";
  return "⚪";
}
