import type { BankProfile } from "./types";

export const tatraProfile: BankProfile = {
  id: "tatra",
  name: "Tatra banka / Raiffeisen",
  country: "SK",
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
        h === "datum zaustovania" ||
        h === "datum transakcie" ||
        h.includes("datum zauct"),
    },
    {
      field: "amount",
      name: "Suma",
      isCore: true,
      matches: (h) => h === "suma" || h === "ciastka",
    },
    {
      field: "currency",
      name: "Mena",
      isCore: true,
      matches: (h) => h === "mena",
    },
    {
      field: "counterparty",
      name: "Protiúčet/IBAN",
      isCore: true,
      matches: (h) =>
        h === "protiucet/iban" ||
        h === "protiucet / iban" ||
        h === "iban protiuctu" ||
        (h.includes("protiucet") && h.includes("iban")),
    },
    {
      field: "counterpartyName",
      name: "Názov protiúčtu",
      isCore: true,
      matches: (h) =>
        h === "nazov protiuctu" ||
        h === "nazov uctu" ||
        h === "nazov partnera",
    },
    {
      field: "description",
      name: "Informácia pre príjemcu",
      isCore: true,
      matches: (h) =>
        h === "informacia pre prijemcu" ||
        h === "informacie pre prijemcu" ||
        h.includes("informacia pre prijemcu") ||
        h.includes("informacie pre prijemcu"),
    },
  ],
  uniqueDetector: (cleaned) =>
    cleaned.some((h) => h.includes("protiucet/iban")) ||
    cleaned.some((h) => h.includes("informacia pre prijemcu")),
};
