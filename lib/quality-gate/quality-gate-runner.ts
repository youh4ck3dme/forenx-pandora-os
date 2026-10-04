/**
 * FORENX / PANDORA - Gemini Quality Gate Runner
 * 
 * Implements the main runner that orchestrates:
 * 1. Collect repository context
 * 2. Redact secrets
 * 3. Build review request
 * 4. Call Gemini
 * 5. Runtime validation
 * 6. Return normalized QualityGateResult
 * 
 * SECURITY: This module is SERVER-ONLY. Never import into browser bundles.
 * 
 * The model itself is NEVER the shell executor. It only analyzes
 * context prepared by trusted application code.
 */

import {
  QualityGateResult,
  QualityGateRequest,
  QualityGateVerdict,
  QualityGateFinding,
  QualityGateMetadata,
  QualityGateConfig,
  QualityGateError,
  QualityGateRequestSchema,
  QualityGateResultSchema,
  parseQualityGateResult,
  parseQualityGateError,
  createConfigurationError,
  createContextTooLargeError,
  createInvalidModelResponseError,
  createSafeResult,
  createNeedsPatchResult,
  createRejectResult,
} from './quality-gate-schema';
import {
  getQualityGateSystemPrompt,
  buildQualityGatePrompt,
} from './quality-gate-system-prompt';
import { QualityGateGeminiClient, type QualityGateApiResult } from './gemini-client';
import {
  collectRepositoryContext,
  buildContextString,
  type RepositoryContext,
  type ContextCollectionConfig,
  DEFAULT_CONTEXT_CONFIG,
} from './repository-context';
import {
  redactSecrets,
  shouldExcludeFile,
  isSecretBearingFile,
  EXCLUDED_FILE_PATTERNS,
  REDACTED_SECRET_MARKER,
} from './redaction';

/**
 * Options for running the quality gate.
 */
export interface QualityGateOptions {
  // Optional task description
  task?: string;
  
  // Mode: always REVIEW_ONLY for safety (default)
  mode?: 'REVIEW_ONLY';
  
  // Optional specific files to review
  files?: string[];
  
  // Optional additional context
  context?: string;
  
  // Optional API key (otherwise reads from GEMINI_API_KEY)
  apiKey?: string;
  
  // Optional model override
  model?: string;
  
  // Optional timeout override (ms)
  timeoutMs?: number;
  
  // Optional max files override
  maxFiles?: number;
  
  // Optional max file bytes override
  maxFileBytes?: number;
  
  // Optional max total context override
  maxTotalContext?: number;
  
  // Whether to write output to file
  writeOutput?: boolean;
  
  // Output file path (defaults to .qa/gemini-quality-gate.json)
  outputPath?: string;
  
  // Repository path override (defaults to process.cwd())
  repoPath?: string;
  
  // Scope: git-diff, working-tree, or full
  scope?: 'git-diff' | 'working-tree' | 'full';
  
  // Include untracked files (default: true for working-tree)
  includeUntracked?: boolean;
  
  // Include staged changes (default: true)
  includeStaged?: boolean;
  
  // Abort signal
  signal?: AbortSignal;
}

/**
 * Result of running the quality gate.
 */
export type QualityGateRunResult =
  | {
      ok: true;
      result: QualityGateResult;
      rawResponse?: string;
      processingTimeMs: number;
    }
  | {
      ok: false;
      error: QualityGateError;
      processingTimeMs: number;
    };

/**
 * Exit codes for CLI usage.
 */
export const EXIT_CODES = {
  SAFE_TO_ACCEPT_LOCALLY: 0,
  NEEDS_PATCH: 1,
  REJECT: 2,
  EXECUTOR_ERROR: 3,
} as const;

/**
 * Get exit code from verdict.
 */
export function getExitCodeFromVerdict(verdict: QualityGateVerdict): number {
  switch (verdict) {
    case 'SAFE_TO_ACCEPT_LOCALLY':
      return EXIT_CODES.SAFE_TO_ACCEPT_LOCALLY;
    case 'NEEDS_PATCH':
      return EXIT_CODES.NEEDS_PATCH;
    case 'REJECT':
      return EXIT_CODES.REJECT;
    default:
      return EXIT_CODES.EXECUTOR_ERROR;
  }
}

/**
 * Main quality gate runner.
 * 
 * This is the primary entry point for running the quality gate review.
 * It orchestrates all phases of the review process.
 */
export class QualityGateRunner {
  private options: QualityGateOptions;
  
  constructor(options: QualityGateOptions = {}) {
    this.options = options;
  }
  
  /**
   * Run the quality gate review.
   * 
   * @returns A promise that resolves to the run result
   */
  async run(): Promise<QualityGateRunResult> {
    const startTime = Date.now();
    
    try {
      // Phase 1: Validate request
      const requestValidation = this.validateRequest();
      if ('error' in requestValidation) {
        return {
          ok: false,
          error: requestValidation.error,
          processingTimeMs: Date.now() - startTime,
        };
      }
      const request = requestValidation.request;
      
      // Phase 2: Collect repository context
      const contextResult = await this.collectContext();
      if ('error' in contextResult) {
        return {
          ok: false,
          error: contextResult.error,
          processingTimeMs: Date.now() - startTime,
        };
      }
      
      // Phase 3: Redact secrets from context
      const redactedResult = this.redactContext(contextResult.context);
      
      // Phase 4: Build prompt
      const prompt = buildQualityGatePrompt(
        redactedResult.redactedContext,
        request.task || undefined
      );
      
      // Phase 5: Validate prompt size
      const promptSize = Buffer.byteLength(prompt, 'utf-8');
      const config = this.getEffectiveConfig();
      
      if (promptSize > config.maxTotalContext) {
        return {
          ok: false,
          error: createContextTooLargeError(
            `Prompt size (${promptSize} bytes) exceeds maximum context (${config.maxTotalContext} bytes)`
          ),
          processingTimeMs: Date.now() - startTime,
        };
      }
      
      // Phase 6: Call Gemini
      const apiResult = await this.callGemini(prompt, contextResult.context);
      
      if ('error' in apiResult) {
        return {
          ok: false,
          error: apiResult.error,
          processingTimeMs: Date.now() - startTime,
        };
      }
      
      // Phase 7: Validate and parse response
      const parseResult = this.parseResponse(
        apiResult.result,
        contextResult.context,
        redactedResult.secretRedactionsCount
      );
      
      if ('error' in parseResult) {
        return {
          ok: false,
          error: parseResult.error,
          processingTimeMs: Date.now() - startTime,
        };
      }
      
      // Phase 8: Write output if requested
      if (this.options.writeOutput) {
        await this.writeOutput(parseResult.result, apiResult.result);
      }
      
      // Phase 9: Return result
      return {
        ok: true,
        result: parseResult.result,
        rawResponse: apiResult.result as string | undefined,
        processingTimeMs: Date.now() - startTime,
      };
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: createConfigurationError(`Unexpected error: ${errorMessage}`, error),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Validate the request options.
   */
  private validateRequest():
    | { ok: true; request: QualityGateRequest }
    | { ok: false; error: QualityGateError } {
    // Build request from options
    const request: QualityGateRequest = {
      task: this.options.task?.substring(0, 1000) || null,
      mode: 'REVIEW_ONLY',
      files: this.options.files || [],
      context: this.options.context?.substring(0, 10000) || null,
    };
    
    // Validate with Zod
    const validation = QualityGateRequestSchema.safeParse(request);
    
    if (!validation.success) {
      return {
        ok: false,
        error: createConfigurationError(
          'Invalid quality gate request',
          validation.error
        ),
      };
    }
    
    return { ok: true, request: validation.data };
  }
  
  /**
   * Collect repository context.
   */
  private async collectContext(): Promise<
    | { ok: true; context: RepositoryContext }
    | { ok: false; error: QualityGateError }
  > {
    const config: ContextCollectionConfig = {
      maxFiles: this.options.maxFiles || this.getEffectiveConfig().maxFiles,
      maxFileBytes: this.options.maxFileBytes || this.getEffectiveConfig().maxFileBytes,
      maxTotalContext: this.options.maxTotalContext || this.getEffectiveConfig().maxTotalContext,
      repoPath: this.options.repoPath,
      scope: this.options.scope,
      includeUntracked: this.options.includeUntracked,
      includeStaged: this.options.includeStaged,
    };
    
    try {
      const context = collectRepositoryContext(config);
      return { ok: true, context };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: createConfigurationError(`Failed to collect repository context: ${errorMessage}`),
      };
    }
  }
  
  /**
   * Redact secrets from the context.
   */
  private redactContext(context: RepositoryContext): {
    redactedContext: string;
    secretRedactionsCount: number;
  } {
    // Build context string
    const contextString = buildContextString(context);
    
    // Redact secrets
    const redactionResult = redactSecrets(contextString);
    
    return {
      redactedContext: redactionResult.redactedContent,
      secretRedactionsCount: redactionResult.redactionCount,
    };
  }
  
  /**
   * Call the Gemini API.
   */
  private async callGemini(
    prompt: string,
    repoContext: RepositoryContext
  ): Promise<QualityGateApiResult> {
    // Create or get client
    const clientResult = this.getClient();
    if ('error' in clientResult) {
      return { ok: false, error: clientResult.error };
    }
    
    const client = clientResult.client;
    const systemPrompt = getQualityGateSystemPrompt();
    
    try {
      const result = await client.generateContent(
        systemPrompt,
        prompt,
        this.options.signal
      );
      return result;
    } catch (error: unknown) {
      // This shouldn't happen as errors are caught in generateContent,
      // but handle it just in case
      return {
        ok: false,
        error: createInvalidModelResponseError(
          `Unexpected error calling Gemini: ${error instanceof Error ? error.message : String(error)}`
        ),
      };
    }
  }
  
  /**
   * Parse the model response.
   */
  private parseResponse(
    rawResponse: unknown,
    repoContext: RepositoryContext,
    secretRedactionsCount: number
  ): { ok: true; result: QualityGateResult } | { ok: false; error: QualityGateError } {
    // Try to parse the raw response
    if (typeof rawResponse !== 'string') {
      return {
        ok: false,
        error: createInvalidModelResponseError(
          `Model response is not a string: ${typeof rawResponse}`
        ),
      };
    }
    
    // Try to extract JSON from the response
    // The model might wrap the JSON in markdown code blocks
    let jsonString = rawResponse.trim();
    
    // Remove markdown code blocks if present
    if (jsonString.startsWith('```json')) {
      jsonString = jsonString.substring('```json'.length).trim();
    } else if (jsonString.startsWith('```')) {
      jsonString = jsonString.substring(3).trim();
    }
    
    // Remove trailing code blocks
    if (jsonString.endsWith('```')) {
      jsonString = jsonString.substring(0, jsonString.length - 3).trim();
    }
    
    // Try to parse as JSON
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonString);
    } catch (parseError: unknown) {
      // Try to extract JSON from the response
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedJson = JSON.parse(jsonMatch[0]);
        } catch {
          return {
            ok: false,
            error: createInvalidModelResponseError(
              'Model response is not valid JSON',
              { rawResponse: jsonString.substring(0, 1000) }
            ),
          };
        }
      } else {
        return {
          ok: false,
          error: createInvalidModelResponseError(
            'Model response does not contain valid JSON',
            { rawResponse: jsonString.substring(0, 1000) }
          ),
        };
      }
    }
    
    // Prepare candidate data with system-injected metadata if missing or incomplete
    const candidateData = typeof parsedJson === 'object' && parsedJson !== null
      ? { ...parsedJson } as Record<string, any>
      : {};

    // Build authoritative metadata from repository context and config
    const rawMeta = typeof candidateData.metadata === 'object' && candidateData.metadata !== null
      ? candidateData.metadata
      : {};

    const effectiveConfig = this.getEffectiveConfig();
    const effectiveMetadata: QualityGateMetadata = {
      model: typeof rawMeta.model === 'string' && rawMeta.model ? rawMeta.model : effectiveConfig.model,
      reviewedAt: typeof rawMeta.reviewedAt === 'string' && rawMeta.reviewedAt ? rawMeta.reviewedAt : new Date().toISOString(),
      commitSha: repoContext.commitSha || 'unknown',
      branch: repoContext.branch || 'unknown',
      changedFiles: repoContext.changedFiles || [],
      secretRedactionsCount,
      totalContextBytes: repoContext.totalBytes || 0,
      contextTruncated: repoContext.contextTruncated || false,
    };
    candidateData.metadata = effectiveMetadata;

    // Ensure array fields have defaults if model returned null/undefined
    if (!Array.isArray(candidateData.findings)) {
      candidateData.findings = [];
    }
    if (!Array.isArray(candidateData.falseConfidence)) {
      candidateData.falseConfidence = [];
    }
    if (!Array.isArray(candidateData.unverified)) {
      candidateData.unverified = [];
    }
    if (typeof candidateData.minimalRequiredAction !== 'string' || !candidateData.minimalRequiredAction.trim()) {
      candidateData.minimalRequiredAction = candidateData.verdict === 'SAFE_TO_ACCEPT_LOCALLY'
        ? 'No immediate fixes required before local acceptance.'
        : 'Review findings and apply required fixes.';
    }

    // Sanitize findings to match schema
    if (Array.isArray(candidateData.findings)) {
      candidateData.findings = candidateData.findings.map((f: any, idx: number) => ({
        id: typeof f.id === 'string' && f.id ? f.id : `FINDING-${idx + 1}`,
        severity: typeof f.severity === 'string' ? f.severity : 'MEDIUM',
        file: typeof f.file === 'string' && f.file ? f.file : 'unknown',
        symbol: typeof f.symbol === 'string' ? f.symbol : null,
        failureMode: typeof f.failureMode === 'string' && f.failureMode ? f.failureMode : 'Unspecified failure mode',
        impact: typeof f.impact === 'string' && f.impact ? f.impact : 'Unspecified impact',
        proof: typeof f.proof === 'string' && f.proof ? f.proof : 'Unspecified proof',
        requiredFix: typeof f.requiredFix === 'string' && f.requiredFix ? f.requiredFix : 'Unspecified fix',
        lineNumber: typeof f.lineNumber === 'number' && f.lineNumber > 0 ? f.lineNumber : (typeof f.line === 'number' && f.line > 0 ? f.line : null),
        columnNumber: typeof f.columnNumber === 'number' && f.columnNumber > 0 ? f.columnNumber : null,
      }));
    }

    // Parse with Zod schema
    const validation = QualityGateResultSchema.safeParse(candidateData);

    if (!validation.success) {
      return {
        ok: false,
        error: createInvalidModelResponseError(
          'Model response does not match QualityGateResult schema',
          {
            zodIssues: validation.error.issues,
            parsedJson: JSON.stringify(parsedJson).substring(0, 1000)
          }
        ),
      };
    }

    return { ok: true, result: validation.data };
  }
  
  /**
   * Get or create the Gemini client.
   */
  private getClient():
    | { ok: true; client: QualityGateGeminiClient }
    | { ok: false; error: QualityGateError } {
    const apiKey = this.options.apiKey || process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey.length < 16) {
      return {
        ok: false,
        error: createConfigurationError(
          'GEMINI_API_KEY is required. Set it in the server environment.'
        ),
      };
    }
    
    return QualityGateGeminiClient.create(
      apiKey,
      this.options.model,
      this.options.timeoutMs,
      this.options.maxFiles,
      this.options.maxFileBytes,
      this.options.maxTotalContext
    );
  }
  
  /**
   * Get effective configuration from options and environment.
   */
  private getEffectiveConfig(): QualityGateConfig {
    return {
      apiKey: this.options.apiKey || process.env.GEMINI_API_KEY || '',
      model: this.options.model || process.env.GEMINI_QUALITY_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      timeoutMs: this.options.timeoutMs || 
        (process.env.GEMINI_QUALITY_TIMEOUT_MS ? 
          parseInt(process.env.GEMINI_QUALITY_TIMEOUT_MS, 10) : 120000),
      maxFiles: this.options.maxFiles || 
        (process.env.GEMINI_QUALITY_MAX_FILES ? 
          parseInt(process.env.GEMINI_QUALITY_MAX_FILES, 10) : 40),
      maxFileBytes: this.options.maxFileBytes || 
        (process.env.GEMINI_QUALITY_MAX_FILE_BYTES ? 
          parseInt(process.env.GEMINI_QUALITY_MAX_FILE_BYTES, 10) : 157286),
      maxTotalContext: this.options.maxTotalContext || 
        (process.env.GEMINI_QUALITY_MAX_TOTAL_CONTEXT ? 
          parseInt(process.env.GEMINI_QUALITY_MAX_TOTAL_CONTEXT, 10) : 1048576),
    };
  }
  
  /**
   * Write output to file.
   */
  private async writeOutput(result: QualityGateResult, rawResponse: unknown): Promise<void> {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      
      const outputPath = this.options.outputPath || '.qa/gemini-quality-gate.json';
      const dir = path.dirname(outputPath);
      
      // Create directory if it doesn't exist
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      
      const output = {
        result,
        rawResponse: typeof rawResponse === 'string' ? rawResponse : null,
        timestamp: new Date().toISOString(),
      };
      
      await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    } catch {
      // Silently ignore write errors - not critical
    }
  }
  
  /**
   * Format the result as a human-readable summary.
   * 
   * @param result - The quality gate result
   * @returns A formatted string summary
   */
  static formatResultSummary(result: QualityGateResult): string {
    const lines: string[] = [];
    
    lines.push('');
    lines.push('═'.repeat(70));
    lines.push('FORENX QUALITY GATE');
    lines.push('═'.repeat(70));
    lines.push('');
    lines.push(`Verdict: ${result.verdict}`);
    lines.push(`Readiness: ${result.productionReadiness}/100`);
    lines.push('');
    
    // Count findings by severity
    const severityCounts: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFORMATIONAL: 0,
    };
    
    for (const finding of result.findings) {
      severityCounts[finding.severity] = (severityCounts[finding.severity] || 0) + 1;
    }
    
    lines.push('Findings:');
    lines.push(`  Critical: ${severityCounts.CRITICAL}`);
    lines.push(`  High: ${severityCounts.HIGH}`);
    lines.push(`  Medium: ${severityCounts.MEDIUM}`);
    lines.push(`  Low: ${severityCounts.LOW}`);
    lines.push(`  Informational: ${severityCounts.INFORMATIONAL}`);
    lines.push('');
    
    if (result.falseConfidence.length > 0) {
      lines.push('False Confidence:');
      for (const fc of result.falseConfidence) {
        lines.push(`  - ${fc}`);
      }
      lines.push('');
    }
    
    if (result.unverified.length > 0) {
      lines.push('Unverified:');
      for (const uv of result.unverified) {
        lines.push(`  - ${uv}`);
      }
      lines.push('');
    }
    
    lines.push('Minimal Required Action:');
    lines.push(`  ${result.minimalRequiredAction}`);
    lines.push('');
    
    lines.push('Metadata:');
    lines.push(`  Model: ${result.metadata.model}`);
    lines.push(`  Reviewed: ${result.metadata.reviewedAt}`);
    lines.push(`  Commit: ${result.metadata.commitSha.substring(0, 8)}`);
    lines.push(`  Branch: ${result.metadata.branch}`);
    lines.push(`  Files: ${result.metadata.changedFiles.length}`);
    lines.push(`  Secrets Redacted: ${result.metadata.secretRedactionsCount}`);
    lines.push('═'.repeat(70));
    lines.push('');
    
    return lines.join('\n');
  }
  
  /**
   * Format a finding for display.
   * 
   * @param finding - The finding to format
   * @returns A formatted string
   */
  static formatFinding(finding: QualityGateFinding): string {
    const lines: string[] = [];
    
    lines.push('');
    lines.push('─'.repeat(70));
    lines.push(`[${finding.severity}] ${finding.file}${finding.symbol ? `:${finding.symbol}` : ''}`);
    lines.push('─'.repeat(70));
    lines.push(`Failure Mode: ${finding.failureMode}`);
    lines.push(`Impact: ${finding.impact}`);
    lines.push(`Proof: ${finding.proof}`);
    lines.push(`Required Fix: ${finding.requiredFix}`);
    
    if (finding.lineNumber) {
      lines.push(`Line: ${finding.lineNumber}`);
    }
    
    if (finding.columnNumber) {
      lines.push(`Column: ${finding.columnNumber}`);
    }
    
    return lines.join('\n');
  }
}

/**
 * Run the quality gate with options.
 * 
 * This is a convenience function for running the quality gate.
 * 
 * @param options - The quality gate options
 * @returns A promise that resolves to the run result
 */
export async function runGeminiQualityGate(
  options: QualityGateOptions = {}
): Promise<QualityGateRunResult> {
  const runner = new QualityGateRunner(options);
  return runner.run();
}

/**
 * Run the quality gate and get the exit code.
 * 
 * @param options - The quality gate options
 * @returns A promise that resolves to the exit code
 */
export async function runGeminiQualityGateAndExit(
  options: QualityGateOptions = {}
): Promise<number> {
  const result = await runGeminiQualityGate(options);
  
  if ('error' in result) {
    console.error('Quality Gate Error:', result.error.message);
    if (result.error.details) {
      console.error('Details:', result.error.details);
    }
    return EXIT_CODES.EXECUTOR_ERROR;
  }
  
  // Print summary
  console.log(QualityGateRunner.formatResultSummary(result.result));
  
  // Print findings if there are any
  if (result.result.findings.length > 0) {
    console.log('\nFindings:');
    for (const finding of result.result.findings) {
      console.log(QualityGateRunner.formatFinding(finding));
    }
  }
  
  return getExitCodeFromVerdict(result.result.verdict);
}
