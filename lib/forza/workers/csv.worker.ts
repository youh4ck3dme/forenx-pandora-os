/// <reference lib="webworker" />
/**
 * Parsovanie CSV mimo hlavného vlákna — UI ostáva responzívne aj pri desiatkach tisíc riadkov.
 * Zrušenie sa robí ukončením workera (`terminate`) na strane UI.
 */
import { parseDelimited, stripBom } from "@/lib/forza/csv/parse";
import { validateRows, type ValidationOptions } from "@/lib/forza/csv/mapping";

type ParseMessage = {
  kind: "parse";
  buffer: ArrayBuffer;
  encoding: string;
  delimiter: string;
};

type ValidateMessage = {
  kind: "validate";
  rows: string[][];
  options: ValidationOptions;
};

export type WorkerRequest = ParseMessage | ValidateMessage;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.kind === "parse") {
      self.postMessage({ kind: "progress", phase: "decode", value: 0.1 });
      const decoder = new TextDecoder(msg.encoding, { fatal: false });
      const text = stripBom(decoder.decode(msg.buffer));
      self.postMessage({ kind: "progress", phase: "parse", value: 0.4 });
      const rows = parseDelimited(text, msg.delimiter);
      const replacement = text.includes("\ufffd");
      self.postMessage({ kind: "parsed", rows, replacement });
      return;
    }
    self.postMessage({ kind: "progress", phase: "validate", value: 0.7 });
    const result = validateRows(msg.rows, msg.options);
    self.postMessage({ kind: "validated", result });
  } catch (error) {
    self.postMessage({
      kind: "error",
      message:
        error instanceof Error ? error.message : "Spracovanie súboru zlyhalo.",
    });
  }
};
