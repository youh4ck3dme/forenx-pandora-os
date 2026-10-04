"use client";

import { useCallback, useRef, useState } from "react";
import { AiConsentDialog } from "@/components/malte/AiConsentDialog";
import {
  AI_CONSENT_VERSION,
  hasAiConsent,
  grantAiConsent,
  AI_CONSENT_PREVIEW_FAILED_MESSAGE,
} from "@/lib/ai-consent";

type PendingState = { preview: string; userId: string; caseId: string } | null;

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
      userId = "local",
    ): Promise<string | null> => {
      if (hasAiConsent(userId, caseId)) return AI_CONSENT_VERSION;

      let preview = "";
      try {
        preview = await buildPreview();
      } catch {
        throw new Error(AI_CONSENT_PREVIEW_FAILED_MESSAGE);
      }
      if (!preview.trim()) {
        throw new Error(AI_CONSENT_PREVIEW_FAILED_MESSAGE);
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        decide.current = resolve;
        setPending({ preview, userId, caseId });
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
