/**
 * P1-01 — Digitálny podpis vyšetrovateľa v exporte.
 *
 * Podpisový blok viaže identitu vyšetrovateľa, UTC časovú pečiatku,
 * SHA-256 dôkazného dossiera, presný text reportu a manifest do
 * deterministického reťazca:
 *
 *   signatureHash = SHA-256(canonical JSON bloku bez samotných hashov)
 *   chainHash     = SHA-256(reportText ‖ signatureHash)
 *
 * chainHash je hash-chain: akákoľvek zmena reportu alebo podpisového bloku
 * po podpise zneplatní nezávislú verifikáciu (verifyInvestigatorSignature).
 * Voliteľná WebAuthn väzba (credentialId + clientDataHash) pridávia podpis
 * na hardvérový kľúč vyšetrovateľa.
 */
import { sha256Hex } from "./provenance/sha256";
import { canonicalJson } from "./provenance/canonical";

export const SIGNATURE_VERSION = "forenx-investigator-signature-v1";

export type WebauthnBinding = {
  /** Base64URL ID kľúča z navigator.credentials.create(). */
  credentialId: string;
  /** SHA-256 clientDataJSON assertionu (viaže výzvu na podpis). */
  clientDataHash: string;
  /** P0-01: hardvérový passkey alebo lokálny softvérový podpis. */
  method?: "webauthn" | "software";
};

export type InvestigatorSignature = {
  version: typeof SIGNATURE_VERSION;
  investigatorId: string;
  investigatorName: string;
  caseId: string;
  /** ISO 8601 UTC časová pečiatka podpisu (server/klient, vždy explicitná). */
  signedAt: string;
  /** SHA-256 kanonického obsahu dossiera (computeDossierSha256). */
  dossierSha256: string;
  /** SHA-256 presného textu reportu (computeReportSha256). */
  reportSha256: string;
  /** SHA-256 manifestu reportu (buildReportPackage.manifestSha256). */
  manifestSha256: string;
  webauthn?: WebauthnBinding;
  /** SHA-256 kanonického JSON bloku (bez signatureHash a chainHash). */
  signatureHash: string;
  /** SHA-256(reportText ‖ signatureHash) — hash-chain s reportom. */
  chainHash: string;
};

export type InvestigatorSignatureInput = {
  investigatorId: string;
  investigatorName: string;
  caseId: string;
  /** Default: aktuálny čas v ISO UTC. */
  signedAt?: string;
  dossierSha256: string;
  reportSha256: string;
  manifestSha256: string;
  /** Presný text reportu, na ktorý sa viaže chainHash. */
  reportText: string;
  webauthn?: WebauthnBinding;
};

function signatureHashOf(
  block: Omit<InvestigatorSignature, "signatureHash" | "chainHash">,
): string {
  return sha256Hex(canonicalJson({ ...block, version: SIGNATURE_VERSION }));
}

/** Zostaví a zaťaží podpisový blok (podpis) vyšetrovateľa. */
export function buildInvestigatorSignature(
  input: InvestigatorSignatureInput,
): InvestigatorSignature {
  const signedAt =
    input.signedAt ?? new Date().toISOString().replace("Z", "+00:00");
  const block: Omit<InvestigatorSignature, "signatureHash" | "chainHash"> = {
    version: SIGNATURE_VERSION,
    investigatorId: input.investigatorId,
    investigatorName: input.investigatorName,
    caseId: input.caseId,
    signedAt,
    dossierSha256: input.dossierSha256,
    reportSha256: input.reportSha256,
    manifestSha256: input.manifestSha256,
    webauthn: input.webauthn,
  };
  const signatureHash = signatureHashOf(block);
  return {
    ...block,
    signatureHash,
    chainHash: sha256Hex(`${input.reportText}\u241f${signatureHash}`),
  };
}

export type SignatureVerification = {
  valid: boolean;
  problems: string[];
};

/**
 * Nezávislá verifikácia podpisového bloku proti reportu a dossieru:
 * prepočíta všetky tri hashovacie väzby (blok, report, chain) a vráti
 * zoznam problémov pri akejkoľvek manipulácii.
 */
export function verifyInvestigatorSignature(
  signature: InvestigatorSignature,
  context: {
    reportText: string;
    dossierSha256: string;
    manifestSha256: string;
  },
): SignatureVerification {
  const problems: string[] = [];

  if (signature.version !== SIGNATURE_VERSION) {
    problems.push(`Neznáma verzia podpisu: ${signature.version}`);
  }
  if (!signature.investigatorId || !signature.investigatorName) {
    problems.push("Podpis neobsahuje identitu vyšetrovateľa.");
  }
  if (Number.isNaN(Date.parse(signature.signedAt))) {
    problems.push("Časová pečiatka podpisu nie je platné ISO 8601.");
  }
  if (sha256Hex(context.reportText) !== signature.reportSha256) {
    problems.push("Text reportu sa nezlučuje s reportSha256 (zmenený obsah).");
  }
  if (context.dossierSha256 !== signature.dossierSha256) {
    problems.push("Obsah dossiera sa nezlučuje s dossierSha256.");
  }
  if (context.manifestSha256 !== signature.manifestSha256) {
    problems.push("Manifest reportu sa nezlučuje s manifestSha256.");
  }

  const { signatureHash: _sig, chainHash: _chain, ...block } = signature;
  const expectedSignatureHash = signatureHashOf(block);
  if (expectedSignatureHash !== signature.signatureHash) {
    problems.push("Podpisový blok bol zmenený (signatureHash nesúhlasí).");
  }

  const expectedChainHash = sha256Hex(
    `${context.reportText}\u241f${signature.signatureHash}`,
  );
  if (expectedChainHash !== signature.chainHash) {
    problems.push("Hash-chain medzi reportom a podpisom je prerušený.");
  }

  return { valid: problems.length === 0, problems };
}
