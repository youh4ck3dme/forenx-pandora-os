import { z } from "zod";

// ─── BRANDED TYPES (NOMINÁLNE TYPY) ──────────────────────────────
declare const BrandSymbol: unique symbol;
export type Brand<T, TBrand extends string> = T & { readonly [BrandSymbol]: TBrand };

export type ApiKey = Brand<string, "ApiKey">;
export type ImageUrl = Brand<string, "ImageUrl">;
export type ModelName = Brand<string, "ModelName">;

export const ApiKeySchema = z
  .string()
  .min(16, "API kľúč musí mať aspoň 16 znakov.")
  .regex(/^[A-Za-z0-9_\-]+$/, "API kľúč obsahuje neplatné znaky.")
  .transform((val): ApiKey => val as ApiKey);

export const ImageUrlSchema = z
  .string()
  .url("Neplatný formát URL obrázka.")
  .transform((val): ImageUrl => val as ImageUrl);

export const ModelNameSchema = z
  .string()
  .min(1)
  .default("mistral-large-latest")
  .transform((val): ModelName => val as ModelName);

// ─── RESULT PATTERN (FUNKCIONÁLNE CHYBOVÉ STAVY) ─────────────────
export type MistralError =
  | { readonly kind: "AuthError"; readonly status: 401 | 403; readonly message: string }
  | { readonly kind: "RateLimitError"; readonly status: 429; readonly message: string; readonly retryAfterMs?: number }
  | { readonly kind: "TimeoutError"; readonly timeoutMs: number; readonly message: string }
  | { readonly kind: "ValidationError"; readonly message: string; readonly details: z.ZodError }
  | { readonly kind: "StreamError"; readonly message: string; readonly bufferSnapshot?: string }
  | { readonly kind: "NetworkError"; readonly status: number; readonly message: string };

export type Result<T, E = MistralError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ─── RUNTIME SCHÉMY PRE POŽIADAVKY A ODPOVEDE ────────────────────
export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1, "Obsah správy nesmie byť prázdny."),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const MistralChunkSchema = z.object({
  id: z.string().optional(),
  choices: z
    .array(
      z.object({
        index: z.number().optional(),
        delta: z.object({
          content: z.string().nullable().optional(),
          role: z.string().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      })
    )
    .default([]),
});
export type MistralChunk = z.infer<typeof MistralChunkSchema>;

export const MistralImageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        url: z.string().url(),
      })
    )
    .min(1, "Odpoveď neobsahuje žiadny vygenerovaný obrázok."),
});

export const MistralErrorPayloadSchema = z.object({
  message: z.string().optional(),
  error: z
    .union([
      z.string(),
      z.object({
        message: z.string().optional(),
        type: z.string().optional(),
        code: z.union([z.string(), z.number()]).optional(),
      }),
    ])
    .optional(),
});
