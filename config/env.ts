import { z } from "zod";

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  MISTRAL_API_KEY: z.string().min(16, "MISTRAL_API_KEY je povinný a musí mať aspoň 16 znakov."),
  MISTRAL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(500_000), // 500 s pre hĺbkový ingest
  S3_ENDPOINT: z.string().url("S3_ENDPOINT musí byť platná URL."),
  S3_REGION: z.string().min(2).default("hel1"),
  S3_BUCKET: z.string().min(3).default("forenx-vault-sk"),
  S3_ACCESS_KEY_ID: z.string().min(5, "S3_ACCESS_KEY_ID je povinný."),
  S3_SECRET_ACCESS_KEY: z.string().min(10, "S3_SECRET_ACCESS_KEY je povinný."),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export function validateEnvironment(customEnv?: Record<string, unknown>): Environment {
  const result = EnvironmentSchema.safeParse(customEnv ?? process.env);
  if (!result.success) {
    console.error("🛑 [FATAL ENVIRONMENT BOOT FAILURE] Neplatná konfigurácia prostredia:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    throw new Error("Server nemôže naštartovať s neplatnými environment premennými.");
  }
  return result.data;
}

export const env: Environment =
  process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development"
    ? EnvironmentSchema.parse({
        NODE_ENV: process.env.NODE_ENV ?? "development",
        MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || "mistral_prod_secret_key_abcdef123456",
        S3_ENDPOINT: process.env.S3_ENDPOINT || "https://hel1.your-objectstorage.com",
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || "test-access-key-id",
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || "test-secret-access-key-very-long",
      })
    : validateEnvironment();
