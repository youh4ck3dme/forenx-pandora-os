import type { BankProfile } from "./types";

export const slspProfile: BankProfile = {
  id: "slsp",
  name: "Slovenská sporiteľňa (SLSP / George)",
  country: "SK",
  defaultDelimiter: ";",
  defaultDecimalSeparator: ",",
  defaultDateFormat: "DD.MM.YYYY",
  defaultCurrency: "EUR",
  signatures: [
    {
      field: "date",
      name: "Dátum",
      isCore: true,
      matches: (h) => h === "datum" || h === "datum zauctovania",
    },
    {
      field: "amount",
      name: "Zaúčtovaná suma",
      isCore: true,
      matches: (h) =>
        h === "zauctovana suma" ||
        (h.includes("zauctovan") && h.includes("suma")),
    },
    {
      field: "counterparty",
      name: "Číslo protiúčtu",
      isCore: true,
      matches: (h) =>
        h === "cislo protiuctu" ||
        h === "iban protiuctu" ||
        h.includes("cislo protiuct"),
    },
    {
      field: "description",
      name: "Správa pre príjemcu",
      isCore: true,
      matches: (h) =>
        h === "sprava pre prijemcu" || h.includes("sprava pre prijemcu"),
    },
    {
      field: "counterpartyName",
      name: "Názov protiúčtu",
      isCore: false,
      matches: (h) => h === "nazov protiuctu" || h === "meno partnera",
    },
    {
      field: "currency",
      name: "Mena",
      isCore: false,
      matches: (h) => h === "mena",
    },
  ],
  uniqueDetector: (cleaned) =>
    cleaned.some(
      (h) =>
        h === "zauctovana suma" ||
        h.includes("zauctovan") ||
        h === "cislo protiuctu",
    ),
};
