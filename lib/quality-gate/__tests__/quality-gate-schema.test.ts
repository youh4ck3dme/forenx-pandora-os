/**
 * FORENX / PANDORA - Gemini Quality Gate Schema Tests
 * 
 * Tests for the Zod schemas and type definitions.
 */

import { describe, it, expect } from 'vitest';
import {
  QualityGateVerdictSchema,
  QualityGateSeveritySchema,
  QualityGateFindingSchema,
  QualityGateMetadataSchema,
  QualityGateResultSchema,
  QualityGateRequestSchema,
  QualityGateConfigSchema,
  QualityGateErrorSchema,
  parseQualityGateResult,
  parseQualityGateError,
  createConfigurationError,
  createInvalidModelResponseError,
  createTimeoutError,
  createContextTooLargeError,
  createSafeResult,
  createNeedsPatchResult,
  createRejectResult,
  type QualityGateResult,
  type QualityGateFinding,
  type QualityGateMetadata,
} from '../quality-gate-schema';

describe('Quality Gate Schema', () => {
  describe('Verdict Schema', () => {
    it('should accept SAFE_TO_ACCEPT_LOCALLY', () => {
      const result = QualityGateVerdictSchema.safeParse('SAFE_TO_ACCEPT_LOCALLY');
      expect(result.success).toBe(true);
      expect(result.data).toBe('SAFE_TO_ACCEPT_LOCALLY');
    });

    it('should accept NEEDS_PATCH', () => {
      const result = QualityGateVerdictSchema.safeParse('NEEDS_PATCH');
      expect(result.success).toBe(true);
      expect(result.data).toBe('NEEDS_PATCH');
    });

    it('should accept REJECT', () => {
      const result = QualityGateVerdictSchema.safeParse('REJECT');
      expect(result.success).toBe(true);
      expect(result.data).toBe('REJECT');
    });

    it('should reject invalid verdict values', () => {
      const result = QualityGateVerdictSchema.safeParse('ACCEPT');
      expect(result.success).toBe(false);
    });
  });

  describe('Severity Schema', () => {
    it('should accept all severity levels', () => {
      const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'] as const;
      for (const severity of severities) {
        const result = QualityGateSeveritySchema.safeParse(severity);
        expect(result.success).toBe(true);
        expect(result.data).toBe(severity);
      }
    });

    it('should reject invalid severity values', () => {
      const result = QualityGateSeveritySchema.safeParse('MINOR');
      expect(result.success).toBe(false);
    });
  });

  describe('Finding Schema', () => {
    it('should accept valid finding', () => {
      const finding = {
        id: 'finding-001',
        severity: 'HIGH' as const,
        file: 'lib/rate-limiter.ts',
        symbol: 'rateLimiter',
        failureMode: 'TOCTOU race condition',
        impact: 'Multiple requests can bypass rate limiting',
        proof: 'Line 42: read-modify-write without lock',
        requiredFix: 'Use atomic operations or distributed lock',
        lineNumber: 42,
        columnNumber: 5,
      };

      const result = QualityGateFindingSchema.safeParse(finding);
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe('finding-001');
      expect(result.data!.severity).toBe('HIGH');
    });

    it('should reject finding without required fields', () => {
      const finding = {
        id: '',
        severity: 'HIGH' as const,
        file: '',
        symbol: null,
        failureMode: '',
        impact: '',
        proof: '',
        requiredFix: '',
      };

      const result = QualityGateFindingSchema.safeParse(finding);
      expect(result.success).toBe(false);
    });

    it('should accept finding with nullable symbol', () => {
      const finding = {
        id: 'finding-002',
        severity: 'MEDIUM' as const,
        file: 'lib/utils.ts',
        symbol: null,
        failureMode: 'Missing validation',
        impact: 'Input not sanitized',
        proof: 'Function accepts any input',
        requiredFix: 'Add Zod validation',
      };

      const result = QualityGateFindingSchema.safeParse(finding);
      expect(result.success).toBe(true);
      expect(result.data!.symbol).toBeNull();
    });
  });

  describe('Metadata Schema', () => {
    it('should accept valid metadata', () => {
      const metadata = {
        model: 'gemini-3.7-flash',
        reviewedAt: '2026-09-28T10:00:00.000Z',
        commitSha: 'abc123def456',
        branch: 'main',
        changedFiles: ['lib/rate-limiter.ts', 'lib/utils.ts'],
        secretRedactionsCount: 3,
        contextTruncated: false,
        totalContextBytes: 1024,
      };

      const result = QualityGateMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
      expect(result.data!.model).toBe('gemini-3.7-flash');
      expect(result.data!.secretRedactionsCount).toBe(3);
    });

    it('should provide defaults for optional fields', () => {
      const metadata = {
        model: 'gemini-3.7-flash',
        reviewedAt: '2026-09-28T10:00:00.000Z',
        commitSha: 'abc123def456',
        branch: 'main',
      };

      const result = QualityGateMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
      expect(result.data!.changedFiles).toEqual([]);
      expect(result.data!.secretRedactionsCount).toBe(0);
      expect(result.data!.contextTruncated).toBe(false);
      expect(result.data!.totalContextBytes).toBe(0);
    });
  });

  describe('Result Schema', () => {
    it('should accept valid result', () => {
      const result = {
        verdict: 'SAFE_TO_ACCEPT_LOCALLY' as const,
        productionReadiness: 85,
        findings: [],
        falseConfidence: [],
        unverified: [],
        minimalRequiredAction: 'Run integration tests',
        metadata: {
          model: 'gemini-3.7-flash',
          reviewedAt: '2026-09-28T10:00:00.000Z',
          commitSha: 'abc123def456',
          branch: 'main',
        },
      };

      const parsed = QualityGateResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data!.verdict).toBe('SAFE_TO_ACCEPT_LOCALLY');
      expect(parsed.data!.productionReadiness).toBe(85);
    });

    it('should reject result with invalid readiness score', () => {
      const result = {
        verdict: 'SAFE_TO_ACCEPT_LOCALLY' as const,
        productionReadiness: 150, // Invalid: must be 0-100
        findings: [],
        falseConfidence: [],
        unverified: [],
        minimalRequiredAction: 'Run tests',
        metadata: {
          model: 'gemini-3.7-flash',
          reviewedAt: '2026-09-28T10:00:00.000Z',
          commitSha: 'abc123def456',
          branch: 'main',
        },
      };

      const parsed = QualityGateResultSchema.safeParse(result);
      expect(parsed.success).toBe(false);
    });

    it('should reject result with empty minimalRequiredAction', () => {
      const result = {
        verdict: 'SAFE_TO_ACCEPT_LOCALLY' as const,
        productionReadiness: 85,
        findings: [],
        falseConfidence: [],
        unverified: [],
        minimalRequiredAction: '',
        metadata: {
          model: 'gemini-3.7-flash',
          reviewedAt: '2026-09-28T10:00:00.000Z',
          commitSha: 'abc123def456',
          branch: 'main',
        },
      };

      const parsed = QualityGateResultSchema.safeParse(result);
      expect(parsed.success).toBe(false);
    });
  });

  describe('Request Schema', () => {
    it('should accept valid request', () => {
      const request = {
        task: 'Review rate limiter',
        mode: 'REVIEW_ONLY' as const,
        files: ['lib/rate-limiter.ts'],
        context: 'Check for race conditions',
      };

      const parsed = QualityGateRequestSchema.safeParse(request);
      expect(parsed.success).toBe(true);
      expect(parsed.data!.mode).toBe('REVIEW_ONLY');
    });

    it('should accept request with null optional fields', () => {
      const request = {
        task: null,
        mode: 'REVIEW_ONLY' as const,
        files: [],
        context: null,
      };

      const parsed = QualityGateRequestSchema.safeParse(request);
      expect(parsed.success).toBe(true);
    });

    it('should reject request with wrong mode', () => {
      const request = {
        mode: 'PATCH_MODE' as const,
      };

      const parsed = QualityGateRequestSchema.safeParse(request);
      expect(parsed.success).toBe(false);
    });
  });

  describe('Config Schema', () => {
    it('should accept valid config', () => {
      const config = {
        apiKey: 'gemini_api_key_1234567890abcdef',
        model: 'gemini-3.7-flash',
        timeoutMs: 120000,
        maxFiles: 40,
        maxFileBytes: 157286,
        maxTotalContext: 1048576,
      };

      const parsed = QualityGateConfigSchema.safeParse(config);
      expect(parsed.success).toBe(true);
    });

    it('should reject config with short API key', () => {
      const config = {
        apiKey: 'short',
        model: 'gemini-3.7-flash',
        timeoutMs: 120000,
        maxFiles: 40,
        maxFileBytes: 157286,
        maxTotalContext: 1048576,
      };

      const parsed = QualityGateConfigSchema.safeParse(config);
      expect(parsed.success).toBe(false);
    });

    it('should reject config with excessive timeout', () => {
      const config = {
        apiKey: 'gemini_api_key_1234567890abcdef',
        model: 'gemini-3.7-flash',
        timeoutMs: 600000, // 10 minutes - exceeds max of 5
        maxFiles: 40,
        maxFileBytes: 157286,
        maxTotalContext: 1048576,
      };

      const parsed = QualityGateConfigSchema.safeParse(config);
      expect(parsed.success).toBe(false);
    });
  });

  describe('Parse Functions', () => {
    it('should parse valid result', () => {
      const validResult: QualityGateResult = {
        verdict: 'SAFE_TO_ACCEPT_LOCALLY',
        productionReadiness: 85,
        findings: [],
        falseConfidence: [],
        unverified: [],
        minimalRequiredAction: 'Run tests',
        metadata: {
          model: 'gemini-3.7-flash',
          reviewedAt: '2026-09-28T10:00:00.000Z',
          commitSha: 'abc123',
          branch: 'main',
          changedFiles: [],
          secretRedactionsCount: 0,
          contextTruncated: false,
          totalContextBytes: 0,
        },
      };

      const parsed = parseQualityGateResult(validResult);
      expect(parsed).not.toBeNull();
      expect(parsed?.verdict).toBe('SAFE_TO_ACCEPT_LOCALLY');
    });

    it('should return null for invalid result', () => {
      const invalidResult = {
        verdict: 'ACCEPT', // Invalid verdict
        productionReadiness: 85,
      };

      const parsed = parseQualityGateResult(invalidResult);
      expect(parsed).toBeNull();
    });

    it('should parse valid error', () => {
      const validError = {
        type: 'CONFIGURATION_ERROR' as const,
        message: 'API key missing',
        timestamp: '2026-09-28T10:00:00.000Z',
      };

      const parsed = parseQualityGateError(validError);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe('CONFIGURATION_ERROR');
    });

    it('should return null for invalid error', () => {
      const invalidError = {
        type: 'UNKNOWN_ERROR', // Invalid type
        message: 'Something went wrong',
      };

      const parsed = parseQualityGateError(invalidError);
      expect(parsed).toBeNull();
    });
  });

  describe('Error Creators', () => {
    it('should create configuration error', () => {
      const error = createConfigurationError('Test error', { detail: 'more info' });
      expect(error.type).toBe('CONFIGURATION_ERROR');
      expect(error.message).toBe('Test error');
      expect(error.details).toEqual({ detail: 'more info' });
    });

    it('should create invalid model response error', () => {
      const error = createInvalidModelResponseError('Invalid JSON');
      expect(error.type).toBe('INVALID_MODEL_RESPONSE');
      expect(error.message).toBe('Invalid JSON');
    });

    it('should create timeout error', () => {
      const error = createTimeoutError('Request timed out');
      expect(error.type).toBe('DEPENDENCY_TIMEOUT');
      expect(error.message).toBe('Request timed out');
    });

    it('should create context too large error', () => {
      const error = createContextTooLargeError('Context exceeds limit');
      expect(error.type).toBe('CONTEXT_TOO_LARGE');
      expect(error.message).toBe('Context exceeds limit');
    });
  });

  describe('Result Builders', () => {
    const baseMetadata: QualityGateMetadata = {
      model: 'gemini-3.7-flash',
      reviewedAt: '2026-09-28T10:00:00.000Z',
      commitSha: 'abc123',
      branch: 'main',
      changedFiles: [],
      secretRedactionsCount: 0,
      contextTruncated: false,
      totalContextBytes: 0,
    };

    it('should create SAFE result', () => {
      const result = createSafeResult(
        90,
        [],
        [],
        [],
        'Code is production ready',
        baseMetadata
      );

      expect(result.verdict).toBe('SAFE_TO_ACCEPT_LOCALLY');
      expect(result.productionReadiness).toBe(90);
      expect(result.minimalRequiredAction).toBe('Code is production ready');
    });

    it('should create NEEDS_PATCH result', () => {
      const finding: QualityGateFinding = {
        id: 'finding-001',
        severity: 'HIGH',
        file: 'lib/rate-limiter.ts',
        symbol: 'rateLimiter',
        failureMode: 'Race condition',
        impact: 'Rate limit bypass',
        proof: 'Line 42',
        requiredFix: 'Add lock',
      };

      const result = createNeedsPatchResult(
        70,
        [finding],
        ['Rate limiting not tested'],
        ['Vercel behavior'],
        'Fix race condition',
        baseMetadata
      );

      expect(result.verdict).toBe('NEEDS_PATCH');
      expect(result.findings).toHaveLength(1);
      expect(result.falseConfidence).toEqual(['Rate limiting not tested']);
    });

    it('should create REJECT result', () => {
      const result = createRejectResult(
        20,
        [],
        [],
        [],
        'Fundamentally unsafe',
        baseMetadata
      );

      expect(result.verdict).toBe('REJECT');
      expect(result.productionReadiness).toBe(20);
    });
  });
});
