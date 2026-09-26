"use client";

import { useCallback, useRef, useState } from "react";
import { AiConsentDialog } from "@/components/malte/AiConsentDialog";

const AI_CONSENT_VERSION = "1.0";
const CONSENT_KEY_PREFIX = "forza-ai-consent-";

function hasAiConsent(userId: string, caseId: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(`${CONSENT_KEY_PREFIX}${userId}-${caseId}`) === AI_CONSENT_VERSION;
}

function grantAiConsent(userId: string, caseId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${CONSENT_KEY_PREFIX}${userId}-${caseId}`, AI_CONSENT_VERSION);
}

type PendingState = { preview: string } | null;

/**
 * Súhlas pred prvým odoslaním údajov prípadu do AI.
 * `ensureConsent` vráti verziu súhlasu, alebo `null`, ak používateľ odmietol.
 */
export function useAiConsent() {
  const [pending, setPending] = useState<PendingState>(null);
  const decide = useRef<((ok: boolean) => void) | null>(null);

  const ensureConsent = useCallback(
    async (
      caseId: string,
      buildPreview: () => string | Promise<string>,
    ): Promise<string | null> => {
      const userId = "local";
      if (hasAiConsent(userId, caseId)) return AI_CONSENT_VERSION;

      let preview = "";
      try {
        preview = await buildPreview();
      } catch {
        throw new Error("Nepodarilo sa zostaviť náhľad dát pre AI.");
      }
      if (!preview.trim()) {
        throw new Error("Nepodarilo sa zostaviť náhľad dát pre AI.");
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        decide.current = resolve;
        setPending({ preview });
      });
      decide.current = null;
      setPending(null);
      if (!confirmed) return null;
      grantAiConsent(userId, caseId);
      return AI_CONSENT_VERSION;
    },
    [],
  );

  const consentDialog = (
    <AiConsentDialog
      open={pending !== null}
      preview={pending?.preview ?? ""}
      onDecision={(ok: boolean) => decide.current?.(ok)}
    />
  );

  return { ensureConsent, consentDialog };
}
