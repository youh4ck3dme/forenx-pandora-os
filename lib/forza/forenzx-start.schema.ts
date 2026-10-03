import { z } from "zod";

export const ForenzxStartRequestSchema = z.object({
  evidenceId: z.string().uuid(),
  inputType: z.string().min(1).max(64),
  packId: z.string().min(1).max(128).default("mobile_compromise"),
});

export type ForenzxStartRequest = z.infer<typeof ForenzxStartRequestSchema>;
