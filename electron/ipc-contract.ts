import { z } from "zod";

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
