import { redactPii, type RedactionCategory, type RedactionOptions } from "./pii-redactor";

/**
 * Jediná brána pred LLM: každá správa okrem systémovej prejde redakciou.
 * Poradie pipeline: dokument/OCR → (klasifikácia v volajúcom) → redakcia →
 * súhlas/politika (assertAiConsent vo volajúcom) → LLM.
 *
 * Brána loguje iba počty nahradení, nikdy text pred redakciou.
 */
export type GatewayMessage = { role: "system" | "user" | "assistant"; content: string };

export type GatewayReport = Record<RedactionCategory, number>;

export function applyPrivacyGateway<T extends GatewayMessage>(
  messages: T[],
  options: RedactionOptions = {},
): { messages: T[]; report: GatewayReport } {
  const report: GatewayReport = {
    birth_number: 0,
    iban: 0,
    id_document: 0,
    email: 0,
    phone: 0,
    masked_term: 0,
  };
  const out = messages.map((message) => {
    if (message.role === "system") return message;
    const { text, counts } = redactPii(message.content, options);
    for (const key of Object.keys(counts) as RedactionCategory[]) {
      report[key] += counts[key];
    }
    return { ...message, content: text };
  });
  return { messages: out, report };
}
