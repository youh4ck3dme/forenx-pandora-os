import { describe, expect, it } from "vitest";
import {
  detectBankFormat,
  normalizeAmount,
  normalizeAmountToCents,
  normalizeDate,
  parseBankCsv,
  registerBankProfile,
  bankRegistry,
} from "../csv/bank-detector";

describe("Bank CSV Auto-Mapping Engine (GAP 11)", () => {
  describe("1. Detektor Bankových Formátov", () => {
    it("deteguje Tatra banka / Raiffeisen s 100% zhodou", () => {
      const headers = [
        "Dátum zaúčtovania",
        "Suma",
        "Mena",
        "Protiúčet/IBAN",
        "Názov protiúčtu",
        "Informácia pre príjemcu",
      ];
      const result = detectBankFormat(headers);
      expect(result).not.toBeNull();
      expect(result?.bankId).toBe("tatra");
      expect(result?.bankName).toContain("Tatra banka");
      expect(result?.confidence).toBe(100);
      expect(result?.mapping.date).toBe(0);
      expect(result?.mapping.amount).toBe(1);
      expect(result?.mapping.currency).toBe(2);
      expect(result?.mapping.description).toBe(5);
    });

    it("deteguje Slovenská sporiteľňa (SLSP / George) s 100% zhodou", () => {
      const headers = [
        "Dátum",
        "Zaúčtovaná suma",
        "Číslo protiúčtu",
        "Správa pre príjemcu",
      ];
      const result = detectBankFormat(headers);
      expect(result).not.toBeNull();
      expect(result?.bankId).toBe("slsp");
      expect(result?.bankName).toContain("Slovenská sporiteľňa");
      expect(result?.confidence).toBe(100);
      expect(result?.mapping.date).toBe(0);
      expect(result?.mapping.amount).toBe(1);
      expect(result?.mapping.description).toBe(3);
    });

    it("deteguje VÚB banka s 100% zhodou", () => {
      const headers = [
        "Dátum valúty",
        "Čiastka",
        "IBAN partnera",
        "Popis transakcie",
      ];
      const result = detectBankFormat(headers);
      expect(result).not.toBeNull();
      expect(result?.bankId).toBe("vub");
      expect(result?.bankName).toContain("VÚB banka");
      expect(result?.confidence).toBe(100);
      expect(result?.mapping.date).toBe(0);
      expect(result?.mapping.amount).toBe(1);
      expect(result?.mapping.description).toBe(3);
    });

    it("deteguje ČSOB (SK & CZ) s 100% zhodou", () => {
      const headers = [
        "Dátum zaúčtovania",
        "Objem",
        "Protiúčet",
        "Poznámka",
      ];
      const result = detectBankFormat(headers);
      expect(result).not.toBeNull();
      expect(result?.bankId).toBe("csob");
      expect(result?.bankName).toContain("ČSOB");
      expect(result?.confidence).toBe(100);
      expect(result?.mapping.date).toBe(0);
      expect(result?.mapping.amount).toBe(1);
      expect(result?.mapping.description).toBe(3);
    });

    it("deteguje Fio banka s 100% zhodou", () => {
      const headers = [
        "Dátum",
        "Objem",
        "Mena",
        "Protiúčet",
        "Správa",
      ];
      const result = detectBankFormat(headers);
      expect(result).not.toBeNull();
      expect(result?.bankId).toBe("fio");
      expect(result?.bankName).toContain("Fio banka");
      expect(result?.confidence).toBe(100);
      expect(result?.mapping.date).toBe(0);
      expect(result?.mapping.amount).toBe(1);
      expect(result?.mapping.currency).toBe(2);
      expect(result?.mapping.description).toBe(4);
    });
  });

  describe("2. Normalizácia Čísel a Dátumov", () => {
    it("správne normalizuje rôzne formáty dátumov na ISO formát YYYY-MM-DD", () => {
      expect(normalizeDate("27.09.2026")).toBe("2026-09-27");
      expect(normalizeDate("01.05.2025")).toBe("2025-05-01");
      expect(normalizeDate("1.5.2025")).toBe("2025-05-01");
      expect(normalizeDate("2026-09-27")).toBe("2026-09-27");
      expect(normalizeDate("27/09/2026")).toBe("2026-09-27");
      expect(normalizeDate("27-09-2026")).toBe("2026-09-27");
      expect(normalizeDate("2026.09.27")).toBe("2026-09-27");
      expect(normalizeDate("2026/09/27")).toBe("2026-09-27");

      // Neplatné dátumy
      expect(normalizeDate("32.01.2026")).toBeNull();
      expect(normalizeDate("29.02.2025")).toBeNull(); // 2025 nie je priestupný
      expect(normalizeDate("neplatny")).toBeNull();
    });

    it("správne normalizuje desatinné čiarky, bodky a tisícové medzery do centov", () => {
      expect(normalizeAmountToCents("1 250,50 €")).toBe(125050);
      expect(normalizeAmountToCents("-1 250,50 €")).toBe(-125050);
      expect(normalizeAmountToCents("1 250,50")).toBe(125050);
      expect(normalizeAmountToCents("1,250.50")).toBe(125050);
      expect(normalizeAmountToCents("1.250,50")).toBe(125050);
      expect(normalizeAmountToCents("1250.50")).toBe(125050);
      expect(normalizeAmountToCents("1250,50")).toBe(125050);
      expect(normalizeAmountToCents("100")).toBe(10000);
      expect(normalizeAmountToCents("(500,25 €)")).toBe(-50025);
      expect(normalizeAmountToCents("0,50 €")).toBe(50);
      expect(normalizeAmountToCents("-0,05 €")).toBe(-5);
      expect(normalizeAmountToCents("1 250,50 CZK")).toBe(125050);
    });

    it("správne normalizuje sumu na float číslo", () => {
      expect(normalizeAmount("1 250,50 €")).toBe(1250.5);
      expect(normalizeAmount("-1 250,50 €")).toBe(-1250.5);
      expect(normalizeAmount("100")).toBe(100);
    });

    it("odmieta tiché zaokrúhlenie a nebezpečne veľké sumy", () => {
      expect(normalizeAmountToCents("12,345")).toBeNull();
      expect(normalizeAmountToCents("999999999999999999999999")).toBeNull();
    });
  });

  describe("3. Parsovanie reálnych vzoriek CSV bankových výpisov", () => {
    it("úspešne parsuje vzorku výpisu Tatra banky", () => {
      const csv = [
        `"Dátum zaúčtovania";"Suma";"Mena";"Protiúčet/IBAN";"Názov protiúčtu";"Informácia pre príjemcu"`,
        `"27.09.2026";"-1 250,50";"EUR";"SK8911000000002948294829";"ACME s.r.o.";"Faktura 20260901"`,
        `"25.09.2026";"3 400,00";"EUR";"SK0202000000001928374650";"Invest Consulting";"Zaloha na sluzby"`,
      ].join("\n");

      const result = parseBankCsv(csv, { ownAccountName: "Môj Firemný Účet" });
      expect(result.detectedBank?.bankId).toBe("tatra");
      expect(result.detectedBank?.confidence).toBe(100);
      expect(result.validCount).toBe(2);

      const [tx1, tx2] = result.transactions;
      expect(tx1).toBeDefined();
      expect(tx1?.date).toBe("2026-09-27");
      expect(tx1?.amount).toBe(-1250.5);
      expect(tx1?.amountCents).toBe(-125050);
      expect(tx1?.from).toBe("Môj Firemný Účet");
      expect(tx1?.to).toBe("ACME s.r.o.");
      expect(tx1?.description).toBe("Faktura 20260901");

      expect(tx2).toBeDefined();
      expect(tx2?.date).toBe("2026-09-25");
      expect(tx2?.amount).toBe(3400);
      expect(tx2?.amountCents).toBe(340000);
      expect(tx2?.from).toBe("Invest Consulting");
      expect(tx2?.to).toBe("Môj Firemný Účet");
    });

    it("úspešne parsuje vzorku výpisu Slovenská sporiteľňa (SLSP / George)", () => {
      const csv = [
        `"Dátum";"Zaúčtovaná suma";"Číslo protiúčtu";"Správa pre príjemcu"`,
        `"26.09.2026";"-450,00";"SK1209000000001234567890";"Telekom Slovensko"`,
        `"24.09.2026";"1 800,50";"SK3409000000009876543210";"Advokatska kancelaria"`,
      ].join("\n");

      const result = parseBankCsv(csv, { ownAccountName: "Spis Subject" });
      expect(result.detectedBank?.bankId).toBe("slsp");
      expect(result.detectedBank?.confidence).toBe(100);
      expect(result.validCount).toBe(2);

      const [tx1, tx2] = result.transactions;
      expect(tx1?.amountCents).toBe(-45000);
      expect(tx1?.from).toBe("Spis Subject");
      expect(tx1?.to).toBe("SK1209000000001234567890");

      expect(tx2?.amountCents).toBe(180050);
      expect(tx2?.from).toBe("SK3409000000009876543210");
      expect(tx2?.to).toBe("Spis Subject");
    });

    it("úspešne parsuje vzorku výpisu VÚB banka", () => {
      const csv = [
        `"Dátum valúty";"Čiastka";"IBAN partnera";"Popis transakcie"`,
        `"27.09.2026";"-320,00";"SK4502000000005544332211";"Kancelarske potreby"`,
        `"22.09.2026";"5 000,00";"SK6702000000001122334455";"Platba zmluvy"`,
      ].join("\n");

      const result = parseBankCsv(csv);
      expect(result.detectedBank?.bankId).toBe("vub");
      expect(result.detectedBank?.confidence).toBe(100);
      expect(result.validCount).toBe(2);
      expect(result.transactions[0]?.amount).toBe(-320);
      expect(result.transactions[1]?.amount).toBe(5000);
    });

    it("úspešne parsuje vzorku výpisu Fio banka", () => {
      const csv = [
        `"Dátum";"Objem";"Mena";"Protiúčet";"Správa"`,
        `"27.09.2026";"-89,90";"EUR";"SK2283300000001234123412";"Domena a server"`,
        `"23.09.2026";"1 250,50";"EUR";"SK1183300000009876987698";"Analyza dat"`,
      ].join("\n");

      const result = parseBankCsv(csv);
      expect(result.detectedBank?.bankId).toBe("fio");
      expect(result.detectedBank?.confidence).toBe(100);
      expect(result.validCount).toBe(2);
      expect(result.transactions[0]?.amountCents).toBe(-8990);
      expect(result.transactions[1]?.amountCents).toBe(125050);
    });
  });

  describe("4. Strategy Pattern a dynamický register profilov bánk", () => {
    it("umožňuje zaregistrovať novú banku (napr. Prima banka) bez zmeny existujúcich profilov", () => {
      registerBankProfile({
        id: "prima",
        name: "Prima banka Slovensko",
        country: "SK",
        defaultDelimiter: ";",
        defaultDecimalSeparator: ",",
        defaultDateFormat: "DD.MM.YYYY",
        defaultCurrency: "EUR",
        signatures: [
          {
            field: "date",
            name: "Dátum transakcie",
            isCore: true,
            matches: (h) => h === "datum transakcie prima",
          },
          {
            field: "amount",
            name: "Objem transakcie",
            isCore: true,
            matches: (h) => h === "objem transakcie prima",
          },
          {
            field: "counterparty",
            name: "Účet príjemcu",
            isCore: true,
            matches: (h) => h === "ucet prijemcu prima",
          },
          {
            field: "description",
            name: "Dôvod platby",
            isCore: true,
            matches: (h) => h === "dovod platby prima",
          },
        ],
      });

      const headers = [
        "datum transakcie prima",
        "objem transakcie prima",
        "ucet prijemcu prima",
        "dovod platby prima",
      ];
      const result = detectBankFormat(headers);
      expect(result).not.toBeNull();
      expect(result?.bankId).toBe("prima");
      expect(result?.bankName).toBe("Prima banka Slovensko");
      expect(result?.confidence).toBe(100);

      // Cleanup
      bankRegistry.reset();
    });
  });
});
