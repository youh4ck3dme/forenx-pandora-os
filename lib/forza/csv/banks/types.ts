import type { Delimiter, DateFormat, DecimalSeparator } from "../parse";

export type BankId = "tatra" | "slsp" | "vub" | "csob" | "fio" | string;

export interface BankSignatureRule {
  field:
    | "date"
    | "amount"
    | "currency"
    | "description"
    | "counterparty"
    | "counterpartyName";
  name: string;
  isCore: boolean;
  matches: (cleanHeader: string) => boolean;
}

export interface BankProfile {
  id: BankId;
  name: string;
  country: "SK" | "CZ" | "SK/CZ";
  signatures: BankSignatureRule[];
  defaultDelimiter: Delimiter;
  defaultDecimalSeparator: DecimalSeparator;
  defaultDateFormat: DateFormat;
  defaultCurrency: string;
  uniqueDetector?: (cleaned: string[]) => boolean;
}
