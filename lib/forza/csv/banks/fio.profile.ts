import type { BankProfile } from "./types";

export const fioProfile: BankProfile = {
  id: "fio",
  name: "Fio banka",
  country: "SK/CZ",
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
      name: "Objem",
      isCore: true,
      matches: (h) => h === "objem" || h === "castka",
    },
    {
      field: "currency",
      name: "Mena",
      isCore: true,
      matches: (h) => h === "mena",
    },
    {
      field: "counterparty",
      name: "Protiúčet",
      isCore: true,
      matches: (h) =>
        h === "protiucet" || h === "cislo protiuctu" || h === "iban",
    },
    {
      field: "description",
      name: "Správa",
      isCore: true,
      matches: (h) =>
        h === "sprava" ||
        h === "zprava pro prijemce" ||
        h === "komentar" ||
        h === "popis",
    },
    {
      field: "counterpartyName",
      name: "Názov protiúčtu",
      isCore: false,
      matches: (h) => h === "nazov protiuctu" || h === "nazev protiuctu",
    },
  ],
  uniqueDetector: (cleaned) =>
    cleaned.some((h) => h === "objem") &&
    cleaned.some((h) => h === "sprava" || h === "komentar"),
};
