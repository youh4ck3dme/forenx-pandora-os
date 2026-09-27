import type { BankProfile } from "./types";

export const csobProfile: BankProfile = {
  id: "csob",
  name: "ČSOB (SK & CZ)",
  country: "SK/CZ",
  defaultDelimiter: ";",
  defaultDecimalSeparator: ",",
  defaultDateFormat: "DD.MM.YYYY",
  defaultCurrency: "EUR",
  signatures: [
    {
      field: "date",
      name: "Dátum zaúčtovania",
      isCore: true,
      matches: (h) =>
        h === "datum zauctovania" ||
        h === "datum zauctovani" ||
        h.includes("datum zauct"),
    },
    {
      field: "amount",
      name: "Objem",
      isCore: true,
      matches: (h) => h === "objem" || h === "castka",
    },
    {
      field: "counterparty",
      name: "Protiúčet",
      isCore: true,
      matches: (h) =>
        h === "protiucet" ||
        h === "protiucet / kod banky" ||
        h === "cislo protiuctu",
    },
    {
      field: "description",
      name: "Poznámka",
      isCore: true,
      matches: (h) =>
        h === "poznamka" ||
        h === "zprava pro prijemce" ||
        h === "sprava pre prijemcu",
    },
    {
      field: "counterpartyName",
      name: "Názov protiúčtu",
      isCore: false,
      matches: (h) => h === "nazov protiuctu" || h === "nazev protiuctu",
    },
    {
      field: "currency",
      name: "Mena",
      isCore: false,
      matches: (h) => h === "mena",
    },
  ],
  uniqueDetector: (cleaned) =>
    cleaned.some((h) => h === "objem") &&
    cleaned.some((h) => h === "poznamka"),
};
