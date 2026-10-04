import { useCallback } from "react";
import { useAccountProfile } from "@/lib/hooks/useAccountProfile";
import { computeDossierSha256 } from "@/lib/export-pdf";
import { createSignatureBinding } from "@/lib/forza/webauthn-signature";
import { logCaseAccess } from "@/lib/forza/access-audit";
import type { ForensicDossier } from "@/lib/types";

export interface InvestigatorSignatureResult {
  investigator?: {
    id: string;
    name: string;
  };
  webauthn?: NonNullable<Awaited<ReturnType<typeof createSignatureBinding>>>;
}

/**
 * Hook pre kryptografické podpisovanie vyšetrovateľom cez WebAuthn (P0-01 / P1-01 / P1-04).
 */
export function useWebAuthnSignature() {
  const profile = useAccountProfile();

  const signDossier = useCallback(
    async (dossier: ForensicDossier): Promise<InvestigatorSignatureResult> => {
      // P1-04: export citlivého spisu sa nezmeniteľne zaznamená do auditného ledgeri.
      void logCaseAccess(dossier.caseId, "export");

      // P1-01: export podpíše vyšetrovateľ (identita z profilu), ak je profil vyplnený.
      const investigatorInfo = profile.data?.fullName
        ? {
            id: profile.data?.email || profile.data.fullName,
            name: profile.data.fullName,
          }
        : undefined;

      if (!investigatorInfo) {
        return {};
      }

      // P0-01: podpis viažeme na passkey (navigator.credentials.create);
      // fallback = lokálny neexportovateľný softvérový kľúč.
      const binding = await createSignatureBinding({
        challenge: computeDossierSha256(dossier),
        userId: investigatorInfo.id,
        userName: investigatorInfo.name,
      });

      return {
        investigator: investigatorInfo,
        webauthn: binding ?? undefined,
      };
    },
    [profile.data?.fullName, profile.data?.email],
  );

  return {
    profile,
    signDossier,
  };
}
