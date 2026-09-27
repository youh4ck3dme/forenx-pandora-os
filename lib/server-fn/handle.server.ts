import { runWithRequestHeaders } from "./request-context.server";
import { getServerFn, type RegisteredServerFn } from "./registry.server";
import { SERVER_FN_ID_PATTERN } from "@/lib/tanstack-start-shim";

/**
 * Serverové spracovanie POST /api/fn/<id>. Route súbor smie exportovať iba
 * handlery, preto logika (a jej testy) žije tu.
 *
 * 20 súborov × 12 M znakov base64 (extractBulkFilesText) ≈ 240 MB; limit
 * zodpovedá nginx client_max_body_size pre /api/fn/.
 */
export const SERVER_FN_MAX_BODY_BYTES = 256 * 1024 * 1024;
const MAX_ERROR_LENGTH = 500;

type Json = { ok: true; result: unknown } | { ok: false; error: string };
export type ServerFnResponse = { status: number; body: Json };

const fail = (status: number, error: string): ServerFnResponse => ({ status, body: { ok: false, error } });

async function readBodyWithLimit(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function errorResponse(error: unknown): ServerFnResponse {
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "ZodError") {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    return fail(400, (issues?.[0]?.message ?? "Neplatné vstupné údaje.").slice(0, MAX_ERROR_LENGTH));
  }
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Unauthorized")) return fail(401, "Neprihlásený alebo neplatný token.");
  // Chyby konfigurácie (názvy env premenných) klientovi neprezrádzame.
  if (/environment variable/i.test(message)) return fail(500, "Server nie je správne nakonfigurovaný.");
  return fail(500, (message || "Serverová funkcia zlyhala.").slice(0, MAX_ERROR_LENGTH));
}

export async function handleServerFnRequest(
  request: Request,
  id: string,
  deps: {
    lookup?: (id: string) => RegisteredServerFn | undefined;
    isProduction?: boolean;
    maxBodyBytes?: number;
  } = {},
): Promise<ServerFnResponse> {
  if (!SERVER_FN_ID_PATTERN.test(id)) return fail(404, "Neznáma serverová funkcia.");
  const fn = (deps.lookup ?? getServerFn)(id);
  if (!fn) return fail(404, "Neznáma serverová funkcia.");

  // V produkcii sa telo bez Bearer tokenu ani nenačíta (middleware ho aj tak odmietne).
  const isProduction = deps.isProduction ?? process.env.NODE_ENV === "production";
  if (isProduction && !request.headers.get("authorization")?.startsWith("Bearer ")) {
    return fail(401, "Neprihlásený alebo neplatný token.");
  }

  const raw = await readBodyWithLimit(request, deps.maxBodyBytes ?? SERVER_FN_MAX_BODY_BYTES);
  if (raw === null) return fail(413, "Požiadavka je príliš veľká.");
  let data: unknown = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return fail(400, "Neplatné telo požiadavky.");
      }
      data = (parsed as { data?: unknown }).data ?? null;
    } catch {
      return fail(400, "Neplatné telo požiadavky.");
    }
  }

  try {
    const result = await runWithRequestHeaders(request.headers, () =>
      fn({ data: data === null ? undefined : data }),
    );
    return { status: 200, body: { ok: true, result: result ?? null } };
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 500) console.error(`[server-fn] ${id} failed:`, error);
    return response;
  }
}
