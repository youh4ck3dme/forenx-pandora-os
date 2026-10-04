/// <reference lib="webworker" />
/**
 * Prevod binárneho súboru na Base64 mimo hlavného vlákna.
 * Veľké PDF-ká a fotky z mobilu tak nezaseknú rozhranie.
 */

export type Base64Request = { id: number; buffer: ArrayBuffer };
export type Base64Response =
  | { id: number; kind: "ok"; base64: string }
  | { id: number; kind: "error"; message: string };

const CHUNK = 8192;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

self.onmessage = (event: MessageEvent<Base64Request>) => {
  const { id, buffer } = event.data;
  try {
    const base64 = bytesToBase64(new Uint8Array(buffer));
    self.postMessage({ id, kind: "ok", base64 } satisfies Base64Response);
  } catch (error) {
    self.postMessage({
      id,
      kind: "error",
      message: error instanceof Error ? error.message : "Prevod súboru zlyhal.",
    } satisfies Base64Response);
  }
};
