// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseBankCsv,
  parseBankCsvAsync,
} from "../bank-detector";
import { parseBankCsvOffThread } from "../../csv-worker-client";

const HEADERS = ["Dátum", "Zaúčtovaná suma", "Číslo protiúčtu", "Správa pre príjemcu"];

/** Syntetický SLSP výpis s N riadkami (striedanie príchodov/odchodov). */
function buildLargeCsv(rows: number): string {
  const lines = [HEADERS.join(";")];
  for (let i = 0; i < rows; i += 1) {
    const day = String((i % 28) + 1).padStart(2, "0");
    const amount =
      i % 2 === 0
        ? `${(100 + (i % 900)).toFixed(2)}`
        : `-${(50 + (i % 500)).toFixed(2)}`;
    lines.push(
      `${day}.03.2026;${amount};SK${(89_000_000_000 + i).toString()};PLATBA ${i}`,
    );
  }
  return lines.join("\n");
}

const CSV_12K = buildLargeCsv(12_000);

describe("Large-Data CSV — parita a neblokujúce spracovanie", () => {
  it("chunked async výsledok je identický so synchrónnym parseBankCsv", async () => {
    const syncResult = parseBankCsv(CSV_12K);
    const asyncResult = await parseBankCsvAsync(CSV_12K, {
      yieldControl: async () => {},
    });

    expect(syncResult.detectedBank?.bankId).toBe("slsp");
    expect(asyncResult.detectedBank?.bankId).toBe("slsp");

    expect(asyncResult.totalCount).toBe(syncResult.totalCount);
    expect(asyncResult.validCount).toBe(syncResult.validCount);
    expect(asyncResult.validCount).toBe(12_000);
    expect(asyncResult.transactions[0]).toEqual(syncResult.transactions[0]);
    expect(asyncResult.transactions[12_345 % 12_000]).toEqual(
      syncResult.transactions[12_345 % 12_000],
    );
    expect(asyncResult.transactions.at(-1)).toEqual(
      syncResult.transactions.at(-1),
    );
  });

  it("medzi chunkmi sa vracia riadenie — UI vlákno nezamrzne", async () => {
    let yields = 0;
    const yieldControl = async () => {
      yields += 1;
    };

    const result = await parseBankCsvAsync(CSV_12K, {
      chunkSize: 1_000,
      yieldControl,
    });

    expect(result.validCount).toBe(12_000);
    // 12 000 riadkov / chunk 1 000 → presne 11 yieldov medzi chunkmi.
    expect(yields).toBe(11);
  });

  it(
    "benchmark: 100 000+ riadkov (P3-02) sa spracuje korektne a rýchlo",
    async () => {
      const rows = 100_000;
      const csv = buildLargeCsv(rows);

      const syncStart = performance.now();
      const syncResult = parseBankCsv(csv);
      const syncMs = performance.now() - syncStart;

      let yields = 0;
      const asyncStart = performance.now();
      const asyncResult = await parseBankCsvAsync(csv, {
        chunkSize: 2_000,
        yieldControl: async () => {
          yields += 1;
        },
      });
      const asyncMs = performance.now() - asyncStart;

      // Korektnosť pri 100 000 riadkoch.
      expect(syncResult.validCount).toBe(rows);
      expect(asyncResult.validCount).toBe(rows);
      // Chunking reálne prebehol.
      expect(yields).toBe(Math.ceil(rows / 2_000) - 1);

      // Benchmark tlmič: pri skaládnom kóde trvá parsovanie ~sekundy,
      // limit je veľkorysý, aby CI nepadal na pomalom runneri.
      expect(syncMs).toBeLessThan(30_000);
      expect(asyncMs).toBeLessThan(30_000);

      console.info(
        `[benchmark] CSV ${rows} riadkov: sync=${Math.round(syncMs)} ms, ` +
          `chunked async=${Math.round(asyncMs)} ms (${yields} yieldov)`,
      );
    },
    60_000,
  );

  it("worker klient bez podpory Workerov spadne na chunked fallback", async () => {
    // Node prostredie nemá Worker — klient musí vrátiť korektný výsledok.
    const result = await parseBankCsvOffThread(CSV_12K, {
      chunkSize: 4_000,
      yieldControl: async () => {},
    });
    expect(result.validCount).toBe(12_000);
    expect(result.detectedBank?.bankId).toBe("slsp");
  });
});
