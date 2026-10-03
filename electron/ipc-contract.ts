import { z } from "zod";

/**
 * Max length of a password entry ID.
 * IDs are generated as base64(url + ":" + username).
 * Bound calculation:
 * - url max length: 2048 chars
 * - separator ':': 1 byte
 * - username max length: 320 chars (up to 4 bytes per UTF-8 char = 1280 bytes; ASCII = 320 bytes)
 * - ASCII raw bytes: 2048 + 1 + 320 = 2369 bytes → ceil(2369/3)*4 = 3160 base64 chars.
 * - Multi-byte UTF-8 raw bytes: 2048 + 1 + 1280 = 3329 bytes → ceil(3329/3)*4 = 4440 base64 chars.
 * Setting to 4440 safely covers both ASCII (≥ 3160) and full UTF-8 usernames.
 * Shared across preload.ts invokeSchemas and main.mts / password-manager validation.
 */
export const MAX_PASSWORD_ID_LENGTH = 4440;
export const MAX_PASSWORD_RECORD_ID_LENGTH = MAX_PASSWORD_ID_LENGTH;

export const selectEvidenceRequestSchema = z.object({
  caseId: z.string().uuid(),
});

export const readEvidenceChunkRequestSchema = z.object({
  tokenId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive().max(10 * 1024 * 1024),
});

export const openExternalRequestSchema = z.object({
  url: z.string().url().max(2048),
});
