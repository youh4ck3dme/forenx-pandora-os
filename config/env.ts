import { z } from "zod";

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  // Cloud key is required outside court-grade; in court-grade it is optional
  // because evidence AI MUST use the local endpoint (INV-032). See superRefine.
  MISTRAL_API_KEY: z.string().min(16, "MISTRAL_API_KEY musí mať aspoň 16 znakov.").optional(),
  MISTRAL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(500_000), // 500 s pre hĺbkový ingest
  S3_ENDPOINT: z.string().url("S3_ENDPOINT musí byť platná URL."),
  S3_REGION: z.string().min(2).default("hel1"),
  S3_BUCKET: z.string().min(3).default("forenx-vault-sk"),
  S3_ACCESS_KEY_ID: z.string().min(5, "S3_ACCESS_KEY_ID je povinný."),
  S3_SECRET_ACCESS_KEY: z.string().min(10, "S3_SECRET_ACCESS_KEY je povinný."),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),

  // --- Court Pack signing & verification (court-grade) ---
  // Toggles fail-closed enforcement of the signing invariants below.
  FORENZX_COURT_GRADE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),

  // Active signing key id (version/status/valid-from/revoked-at live in the keyring).
  FORENZX_SIGNING_KEY_ID: z.string().min(1).optional(),

  // Reference to the Ed25519 private key — NEVER the key itself. file: is the MVP
  // backend; vault:/kms: are reserved for later without changing the pack format.
  FORENZX_SIGNING_PRIVATE_KEY_REF: z
    .string()
    .refine((v) => /^(file|osstore|vault|kms):/.test(v), {
      message: "FORENZX_SIGNING_PRIVATE_KEY_REF must be a reference (file:/osstore:/vault:/kms:), not a raw key.",
    })
    .refine((v) => !/BEGIN [A-Z ]*PRIVATE KEY/.test(v), {
      message: "FORENZX_SIGNING_PRIVATE_KEY_REF must not contain raw PEM key material.",
    })
    .optional(),

  // Trusted public keyring (JSON array of {kid,version,status,validFrom,revokedAt,publicKeyPem}).
  FORENZX_TRUSTED_PUBLIC_KEYS: z.string().optional(),
  FORENZX_KEYRING_VERSION: z.string().optional(),
  FORENZX_REVOKED_KEY_IDS: z.string().optional(),

  // STIX threat-intel integrity: allowlist of trusted bundle SHA-256 digests.
  FORENZX_TRUSTED_STIX_DIGESTS: z.string().optional(),

  // RFC 3161 timestamping authority for the Court Pack Merkle root.
  FORENZX_TSA_URL: z.string().url("FORENZX_TSA_URL must be a valid URL.").optional(),
  // JSON array of PEM roots/intermediates explicitly trusted for TSA chains.
  FORENZX_TRUSTED_TSA_CERTS: z.string().optional(),

  // Local, air-gappable forensic AI (OpenAI-compatible). Evidence AI must stay local.
  FORENZX_LOCAL_AI_BASE_URL: z.string().url("FORENZX_LOCAL_AI_BASE_URL must be a valid URL.").optional(),
  FORENZX_LOCAL_AI_MODEL: z.string().optional(),
}).superRefine((data, ctx) => {
  // Outside court-grade, the cloud Mistral key stays mandatory (INV-032 only
  // relaxes it when a local evidence-AI endpoint is enforced instead).
  if (!data.FORENZX_COURT_GRADE) {
    if (!data.MISTRAL_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MISTRAL_API_KEY"],
        message: "MISTRAL_API_KEY is required unless FORENZX_COURT_GRADE=true (with a local AI endpoint).",
      });
    }
    return;
  }
  const required = [
    "FORENZX_SIGNING_KEY_ID",
    "FORENZX_SIGNING_PRIVATE_KEY_REF",
    "FORENZX_TRUSTED_PUBLIC_KEYS",
    "FORENZX_KEYRING_VERSION",
    "FORENZX_LOCAL_AI_BASE_URL",
    "FORENZX_TSA_URL", // INV-031: court-grade packs must be RFC 3161 timestamped (fail-closed)
    "FORENZX_TRUSTED_TSA_CERTS",
  ] as const;
  for (const key of required) {
    const value = (data as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when FORENZX_COURT_GRADE=true.`,
      });
    }
  }
  if (data.FORENZX_COURT_GRADE && data.FORENZX_TRUSTED_TSA_CERTS) {
    try {
      const certs = JSON.parse(data.FORENZX_TRUSTED_TSA_CERTS);
      if (!Array.isArray(certs) || certs.length === 0 || certs.some((cert) => typeof cert !== "string" || !cert.includes("BEGIN CERTIFICATE"))) {
        throw new Error("not a non-empty PEM certificate array");
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FORENZX_TRUSTED_TSA_CERTS"],
        message: "FORENZX_TRUSTED_TSA_CERTS must be a non-empty JSON array of PEM certificates.",
      });
    }
  }
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
