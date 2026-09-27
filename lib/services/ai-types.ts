import { z } from "zod";

// ─── BRANDED TYPES ───────────────────────────────────────────────
export type ApiKey = string & { readonly __brand: unique symbol };
export type ImageUrl = string & { readonly __brand: unique symbol };

export function makeApiKey(key: string): ApiKey {
  if (!key || key.trim().length < 8) {
    throw new Error("Neplatný formát API kľúča.");
  }
  return key as ApiKey;
}

export function makeImageUrl(url: string): ImageUrl {
  const parsed = z.string().url().parse(url);
  return parsed as ImageUrl;
}

// ─── RESULT PATTERN ──────────────────────────────────────────────
export type AppError =
  | { readonly kind: "AuthMissing" | "AuthInvalid"; readonly message: string }
  | { readonly kind: "RateLimited"; readonly message: string; readonly retryAfterMs?: number }
  | { readonly kind: "Timeout"; readonly message: string; readonly timeoutMs: number }
  | { readonly kind: "StreamCorrupted"; readonly message: string; readonly rawChunk?: string }
  | { readonly kind: "HttpError"; readonly status: number; readonly message: string };

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ─── RUNTIME RESPONSE SCHEMAS ────────────────────────────────────
export const MistralChunkSchema = z.object({
  id: z.string().optional(),
  choices: z.array(
    z.object({
      index: z.number().optional(),
      delta: z.object({
        content: z.string().nullable().optional(),
        role: z.string().optional(),
      }),
      finish_reason: z.string().nullable().optional(),
    })
  ).default([]),
});

export const GeminiChunkSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(
          z.object({
            text: z.string().optional(),
            thought: z.boolean().optional(),
          })
        ).optional(),
      }).optional(),
      finishReason: z.string().nullable().optional(),
    })
  ).optional(),
});

export const ImageResponseSchema = z.object({
  data: z.array(
    z.object({
      url: z.string().url(),
    })
  ).min(1),
});

export const ApiErrorPayloadSchema = z.object({
  message: z.string().optional(),
  error: z.union([
    z.string(),
    z.object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.union([z.string(), z.number()]).optional(),
    }),
  ]).optional(),
});

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
  readonly imageUrl?: string;
}

export interface CompletionOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
