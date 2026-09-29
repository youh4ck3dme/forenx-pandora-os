/**
 * FORENX / PANDORA - Gemini Quality Gate Schema
 * 
 * Strict TypeScript types and Zod schemas for the independent Gemini code reviewer.
 * All external Gemini responses begin as unknown and are runtime validated.
 * 
 * SECURITY: This module is SERVER-ONLY. Never import into browser bundles.
 */

import { z } from "zod";

// ============================================================================
// VERDICT TYPE
// ============================================================================

export type QualityGateVerdict = 
  | 'SAFE_TO_ACCEPT_LOCALLY'
  | 'NEEDS_PATCH'
  | 'REJECT';

export const QualityGateVerdictSchema = z.enum([
  'SAFE_TO_ACCEPT_LOCALLY',
  'NEEDS_PATCH',
  'REJECT',
]);

// ============================================================================
// SEVERITY TYPE
// ============================================================================

export type QualityGateSeverity = 
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INFORMATIONAL';

export const QualityGateSeveritySchema = z.enum([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFORMATIONAL',
]);

// ============================================================================
// FINDING SCHEMA
// ============================================================================

export const QualityGateFindingSchema = z.object({
  // Unique identifier for this finding
  id: z.string().min(1, "Finding ID is required"),
  
  // Severity level
  severity: QualityGateSeveritySchema,
  
  // File path where the issue was found
  file: z.string().min(1, "File path is required"),
  
  // Symbol/function/class name if applicable
  symbol: z.string().min(1, "Symbol is required").nullable(),
  
  // What failure mode is detected
  failureMode: z.string().min(1, "Failure mode description is required"),
  
  // Impact of this issue
  impact: z.string().min(1, "Impact description is required"),
  
  // Evidence/proof of the issue (code snippet, line number, etc.)
  proof: z.string().min(1, "Proof is required"),
  
  // What must be fixed
  requiredFix: z.string().min(1, "Required fix is required"),
  
  // Optional: line number if available
  lineNumber: z.number().int().positive().nullable().optional(),
  
  // Optional: column number if available
  columnNumber: z.number().int().positive().nullable().optional(),
});

export type QualityGateFinding = z.infer<typeof QualityGateFindingSchema>;

// ============================================================================
// METADATA SCHEMA
// ============================================================================

export const QualityGateMetadataSchema = z.object({
  // Model used for the review
  model: z.string().min(1, "Model is required"),
  
  // Timestamp when review was completed
  reviewedAt: z.string().datetime({ offset: true }),
  
  // Current commit SHA
  commitSha: z.string().min(1, "Commit SHA is required"),
  
  // Current branch
  branch: z.string().min(1, "Branch is required"),
  
  // List of changed files
  changedFiles: z.array(z.string().min(1)).default([]),
  
  // Number of secrets redacted
  secretRedactionsCount: z.number().int().nonnegative().default(0),
  
  // Whether context was truncated
  contextTruncated: z.boolean().default(false),
  
  // Total bytes of context sent
  totalContextBytes: z.number().int().nonnegative().default(0),
});

export type QualityGateMetadata = z.infer<typeof QualityGateMetadataSchema>;

// ============================================================================
// MAIN RESULT SCHEMA
// ============================================================================

export const QualityGateResultSchema = z.object({
  // Primary verdict
  verdict: QualityGateVerdictSchema,
  
  // Technical readiness score (0-100)
  productionReadiness: z.number().int().min(0).max(100),
  
  // List of findings
  findings: z.array(QualityGateFindingSchema).default([]),
  
  // Areas of false confidence detected
  falseConfidence: z.array(z.string().min(1)).default([]),
  
  // Behaviors that remain unverified
  unverified: z.array(z.string().min(1)).default([]),
  
  // Minimal required action before acceptance
  minimalRequiredAction: z.string().min(1, "Minimal required action is required"),
  
  // Review metadata
  metadata: QualityGateMetadataSchema,
});

export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;

// ============================================================================
// ERROR TYPES
// ============================================================================

export type QualityGateErrorType = 
  | 'CONFIGURATION_ERROR'
  | 'INVALID_MODEL_RESPONSE'
  | 'DEPENDENCY_TIMEOUT'
  | 'CONTEXT_TOO_LARGE'
  | 'GEMINI_API_ERROR'
  | 'RETRYABLE_ERROR'
  | 'NON_RETRYABLE_ERROR';

export const QualityGateErrorTypeSchema = z.enum([
  'CONFIGURATION_ERROR',
  'INVALID_MODEL_RESPONSE',
  'DEPENDENCY_TIMEOUT',
  'CONTEXT_TOO_LARGE',
  'GEMINI_API_ERROR',
  'RETRYABLE_ERROR',
  'NON_RETRYABLE_ERROR',
]);

export const QualityGateErrorSchema = z.object({
  type: QualityGateErrorTypeSchema,
  message: z.string().min(1),
  details: z.unknown().optional(),
  timestamp: z.string().datetime({ offset: true }).default(new Date().toISOString()),
});

export type QualityGateError = z.infer<typeof QualityGateErrorSchema>;

// ============================================================================
// REQUEST INPUT SCHEMA
// ============================================================================

export const QualityGateRequestSchema = z.object({
  // Optional task description
  task: z.string().min(1).max(1000).nullable().optional(),
  
  // Mode: always REVIEW_ONLY for safety
  mode: z.literal('REVIEW_ONLY'),
  
  // Optional: specific files to review (defaults to git diff)
  files: z.array(z.string().min(1)).default([]),
  
  // Optional: additional context
  context: z.string().max(10000).nullable().optional(),
});

export type QualityGateRequest = z.infer<typeof QualityGateRequestSchema>;

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

export const QualityGateConfigSchema = z.object({
  apiKey: z.string().min(16, "GEMINI_API_KEY must be at least 16 characters"),
  model: z.string().min(1, "GEMINI_QUALITY_MODEL is required"),
  timeoutMs: z.number().int().positive().max(300000, "Timeout must not exceed 5 minutes"),
  maxFiles: z.number().int().positive().max(100, "Max files must not exceed 100"),
  maxFileBytes: z.number().int().positive().max(1048576, "Max file bytes must not exceed 1MB"),
  maxTotalContext: z.number().int().positive().max(4194304, "Max total context must not exceed 4MB"),
});

export type QualityGateConfig = z.infer<typeof QualityGateConfigSchema>;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Safely parse an unknown value as a QualityGateResult.
 * Returns null if parsing fails.
 */
export function parseQualityGateResult(raw: unknown): QualityGateResult | null {
  const parsed = QualityGateResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Safely parse an unknown value as a QualityGateError.
 * Returns null if parsing fails.
 */
export function parseQualityGateError(raw: unknown): QualityGateError | null {
  const parsed = QualityGateErrorSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Create a typed configuration error.
 */
export function createConfigurationError(message: string, details?: unknown): QualityGateError {
  return {
    type: 'CONFIGURATION_ERROR',
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a typed invalid model response error.
 */
export function createInvalidModelResponseError(message: string, details?: unknown): QualityGateError {
  return {
    type: 'INVALID_MODEL_RESPONSE',
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a typed timeout error.
 */
export function createTimeoutError(message: string, details?: unknown): QualityGateError {
  return {
    type: 'DEPENDENCY_TIMEOUT',
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a typed context too large error.
 */
export function createContextTooLargeError(message: string, details?: unknown): QualityGateError {
  return {
    type: 'CONTEXT_TOO_LARGE',
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// RESULT BUILDERS
// ============================================================================

/**
 * Create a SAFE_TO_ACCEPT_LOCALLY result.
 */
export function createSafeResult(
  productionReadiness: number,
  findings: QualityGateFinding[],
  falseConfidence: string[],
  unverified: string[],
  minimalRequiredAction: string,
  metadata: QualityGateMetadata
): QualityGateResult {
  return {
    verdict: 'SAFE_TO_ACCEPT_LOCALLY',
    productionReadiness,
    findings,
    falseConfidence,
    unverified,
    minimalRequiredAction,
    metadata,
  };
}

/**
 * Create a NEEDS_PATCH result.
 */
export function createNeedsPatchResult(
  productionReadiness: number,
  findings: QualityGateFinding[],
  falseConfidence: string[],
  unverified: string[],
  minimalRequiredAction: string,
  metadata: QualityGateMetadata
): QualityGateResult {
  return {
    verdict: 'NEEDS_PATCH',
    productionReadiness,
    findings,
    falseConfidence,
    unverified,
    minimalRequiredAction,
    metadata,
  };
}

/**
 * Create a REJECT result.
 */
export function createRejectResult(
  productionReadiness: number,
  findings: QualityGateFinding[],
  falseConfidence: string[],
  unverified: string[],
  minimalRequiredAction: string,
  metadata: QualityGateMetadata
): QualityGateResult {
  return {
    verdict: 'REJECT',
    productionReadiness,
    findings,
    falseConfidence,
    unverified,
    minimalRequiredAction,
    metadata,
  };
}
