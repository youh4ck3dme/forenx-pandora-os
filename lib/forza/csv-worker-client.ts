/**
 * P0-03/Large-Data — CSV worker klient.
 *
 * Ťažké parsovanie bankového výpisu beží vo Web Workeri (UI vlákno ostáva
 * responzívne). Keď prehliadač Worker nepodporuje (alebo jeho spustenie
 * zlyhá), spadne sa na chunked parseBankCsvAsync na hlavnom vlákne —
 * medzi chunkmi sa vracia riadenie event loopu, takže UI nezamrzne ani tak.
 */
import {
  parseBankCsvAsync,
  type BankParseAsyncOptions,
  type BankParseResult,
} from "@/lib/forza/csv/bank-detector";

type BankResultMessage = {
  kind: "bank-result";
  result: BankParseResult;
};

type WorkerProgress = { kind: "progress"; phase: string; value: number };
type WorkerErrorMessage = { kind: "error"; message: string };
export type CsvWorkerMessage = BankResultMessage | WorkerProgress | WorkerErrorMessage;

let worker: Worker | undefined;

function getWorker(): Worker | undefined {
  if (worker) return worker;
  if (typeof Worker === "undefined") return undefined;
  try {
    worker = new Worker(new URL("./workers/csv.worker.ts", import.meta.url), {
      type: "module",
    });
    return worker;
  } catch {
    return undefined;
  }
}

/**
 * Parsovanie bankového CSV mimo UI vlákna; fallback = chunked async na
 * hlavnom vlákne. Výsledok je v oboch prípadoch totožný (processBankRow).
 */
export async function parseBankCsvOffThread(
  csvText: string,
  options?: BankParseAsyncOptions & {
    onProgress?: (phase: string, value: number) => void;
  },
): Promise<BankParseResult> {
  const w = getWorker();
  const { onProgress, ...parseOptions } = options ?? {};
  if (!w) return parseBankCsvAsync(csvText, parseOptions);

  try {
    return await new Promise<BankParseResult>((resolve, reject) => {
      const onMessage = (event: MessageEvent<CsvWorkerMessage>) => {
        const data = event.data;
        if (data.kind === "progress") {
          onProgress?.(data.phase, data.value);
          return;
        }
        cleanup();
        if (data.kind === "bank-result") resolve(data.result);
        else reject(new Error(data.message));
      };
      const onError = () => {
        cleanup();
        reject(new Error("Spracovanie CSV vo workeri zlyhalo."));
      };
      const cleanup = () => {
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
      };
      w.addEventListener("message", onMessage);
      w.addEventListener("error", onError);
      w.postMessage({ kind: "bank", text: csvText, options: parseOptions });
    });
  } catch {
    // Worker zlyhal — nespúšťame ho znova a prejdeme na chunked fallback.
    worker?.terminate();
    worker = undefined;
    return parseBankCsvAsync(csvText, parseOptions);
  }
}
