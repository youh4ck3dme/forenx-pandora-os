import type { BankProfile } from "./types";

export const vubProfile: BankProfile = {
  id: "vub",
  name: "VÚB banka",
  country: "SK",
  defaultDelimiter: ";",
  defaultDecimalSeparator: ",",
  defaultDateFormat: "DD.MM.YYYY",
  defaultCurrency: "EUR",
  signatures: [
    {
      field: "date",
      name: "Dátum valúty",
      isCore: true,
      matches: (h) =>
        h === "datum valuty" || h === "valuta" || h.includes("valut"),
    },
    {
      field: "amount",
      name: "Čiastka",
      isCore: true,
      matches: (h) => h === "ciastka" || h === "suma",
    },
    {
      field: "counterparty",
      name: "IBAN partnera",
      isCore: true,
      matches: (h) =>
        h === "iban partnera" ||
        h === "cislo uctu partnera" ||
        h.includes("iban partner"),
    },
    {
      field: "description",
      name: "Popis transakcie",
      isCore: true,
      matches: (h) =>
        h === "popis transakcie" ||
        h === "popis" ||
        h.includes("popis transakcie"),
    },
    {
      field: "counterpartyName",
      name: "Názov partnera",
      isCore: false,
      matches: (h) => h === "nazov partnera" || h === "meno partnera",
    },
    {
      field: "currency",
      name: "Mena",
      isCore: false,
      matches: (h) => h === "mena",
    },
  ],
  uniqueDetector: (cleaned) =>
    cleaned.some((h) => h.includes("valut")) ||
    cleaned.some((h) => h.includes("iban partner")),
};
