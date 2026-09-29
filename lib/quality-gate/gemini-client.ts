/**
 * FORENX / PANDORA - Gemini Quality Gate Client
 * 
 * Server-only Gemini client using @google/genai SDK.
 * API key comes only from validated server environment.
 * 
 * SECURITY: This module is SERVER-ONLY. Never import into browser bundles.
 * 
 * The model itself is NEVER the shell executor. It only analyzes
 * context prepared by trusted application code.
 */

import { GoogleGenAI, type Content, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import {
  QualityGateConfig,
  QualityGateConfigSchema,
  QualityGateError,
  createConfigurationError,
  createTimeoutError,
  createInvalidModelResponseError,
} from './quality-gate-schema';

/**
 * Result type for quality gate API calls.
 */
export type QualityGateApiResult = 
  | { ok: true; result: unknown }
  | { ok: false; error: QualityGateError };

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  maxRetries: number;
  retryableStatuses: Set<number>;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryableStatuses: new Set([429, 502, 503, 504]),
  baseDelayMs: 2000,
  maxDelayMs: 10000,
  jitterFactor: 0.1,
};

/**
 * Gemini client for quality gate operations.
 * 
 * This client wraps the @google/genai SDK with FORENX-specific
 * security and validation layers.
 */
export class QualityGateGeminiClient {
  private client: GoogleGenAI;
  private config: QualityGateConfig;
  private retryConfig: RetryConfig;
  
  private constructor(
    client: GoogleGenAI,
    config: QualityGateConfig,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ) {
    this.client = client;
    this.config = config;
    this.retryConfig = retryConfig;
  }
  
  /**
   * Validate environment and create a configured client.
   * 
   * @param apiKey - The GEMINI_API_KEY from environment
   * @param model - The model to use (defaults to GEMINI_QUALITY_MODEL or gemini-3.7-flash)
   * @param timeoutMs - Timeout in milliseconds
   * @param maxFiles - Maximum files to process
   * @param maxFileBytes - Maximum bytes per file
   * @param maxTotalContext - Maximum total context bytes
   * @returns A configured quality gate client or a configuration error
   */
  static create(
    apiKey: string,
    model?: string,
    timeoutMs?: number,
    maxFiles?: number,
    maxFileBytes?: number,
    maxTotalContext?: number
  ): { ok: true; client: QualityGateGeminiClient } | { ok: false; error: QualityGateError } {
    // Validate API key
    const keyValidation = z.string().min(16, "GEMINI_API_KEY must be at least 16 characters").safeParse(apiKey);
    if (!keyValidation.success) {
      return {
        ok: false,
        error: createConfigurationError(
          keyValidation.error.message || "Invalid GEMINI_API_KEY",
          keyValidation.error
        ),
      };
    }
    
    // Build configuration
    const config: QualityGateConfig = {
      apiKey: keyValidation.data,
      model: model || process.env.GEMINI_QUALITY_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      timeoutMs: timeoutMs || 
        (process.env.GEMINI_QUALITY_TIMEOUT_MS ? 
          parseInt(process.env.GEMINI_QUALITY_TIMEOUT_MS, 10) : 120000),
      maxFiles: maxFiles || 
        (process.env.GEMINI_QUALITY_MAX_FILES ? 
          parseInt(process.env.GEMINI_QUALITY_MAX_FILES, 10) : 40),
      maxFileBytes: maxFileBytes || 
        (process.env.GEMINI_QUALITY_MAX_FILE_BYTES ? 
          parseInt(process.env.GEMINI_QUALITY_MAX_FILE_BYTES, 10) : 157286),
      maxTotalContext: maxTotalContext || 
        (process.env.GEMINI_QUALITY_MAX_TOTAL_CONTEXT ? 
          parseInt(process.env.GEMINI_QUALITY_MAX_TOTAL_CONTEXT, 10) : 1048576),
    };
    
    // Validate configuration
    const configValidation = QualityGateConfigSchema.safeParse(config);
    if (!configValidation.success) {
      return {
        ok: false,
        error: createConfigurationError(
          "Invalid quality gate configuration",
          configValidation.error
        ),
      };
    }
    
    // Create the underlying @google/genai client
    // Note: The SDK doesn't expose a way to set timeout directly on the client,
    // so we handle it in the request layer
    const client = new GoogleGenAI({ apiKey: configValidation.data.apiKey });
    
    return {
      ok: true,
      client: new QualityGateGeminiClient(
        client,
        configValidation.data,
        DEFAULT_RETRY_CONFIG
      ),
    };
  }
  
  /**
   * Validate configuration from environment variables.
   * 
   * @returns A configured quality gate client or a configuration error
   */
  static fromEnvironment(): { ok: true; client: QualityGateGeminiClient } | { ok: false; error: QualityGateError } {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey.length < 16) {
      return {
        ok: false,
        error: createConfigurationError(
          "GEMINI_API_KEY is not set or is invalid. Quality gate requires GEMINI_API_KEY to be set in the server environment."
        ),
      };
    }
    
    return QualityGateGeminiClient.create(
      apiKey,
      process.env.GEMINI_QUALITY_MODEL,
      process.env.GEMINI_QUALITY_TIMEOUT_MS ? parseInt(process.env.GEMINI_QUALITY_TIMEOUT_MS, 10) : undefined,
      process.env.GEMINI_QUALITY_MAX_FILES ? parseInt(process.env.GEMINI_QUALITY_MAX_FILES, 10) : undefined,
      process.env.GEMINI_QUALITY_MAX_FILE_BYTES ? parseInt(process.env.GEMINI_QUALITY_MAX_FILE_BYTES, 10) : undefined,
      process.env.GEMINI_QUALITY_MAX_TOTAL_CONTEXT ? parseInt(process.env.GEMINI_QUALITY_MAX_TOTAL_CONTEXT, 10) : undefined
    );
  }
  
  /**
   * Get the current configuration.
   */
  getConfig(): QualityGateConfig {
    return { ...this.config };
  }
  
  /**
   * Generate content from the quality gate model.
   * 
   * This is the primary method for sending review requests to the model.
   * It handles:
   * - Timeout via AbortController
   * - Retry logic for transient errors
   * - Response validation
   * 
   * @param systemPrompt - The system prompt
   * @param userPrompt - The user prompt (context + task)
   * @param signal - Optional abort signal
   * @returns The raw response or an error
   */
  async generateContent(
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal
  ): Promise<QualityGateApiResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }
    
    try {
      let lastError: Error | undefined;
      let retryCount = 0;
      
      while (retryCount <= this.retryConfig.maxRetries) {
        try {
          // Build the content array for the model
          // System prompt is included as the first message
          const contents: Content[] = [
            {
              role: 'user',
              parts: [{ text: systemPrompt }],
            },
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ];
          
          // Note: The @google/genai SDK uses a different approach for system prompts
          // We need to check the SDK version and adjust accordingly
          // For now, we'll use the simpler generateContent method
          const response = await this.client.models.generateContent({
            model: this.config.model,
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            config: {
              temperature: 0,
              maxOutputTokens: 16384,
            },
          });
          
          clearTimeout(timeout);
          
          // Extract the response text from the result
          // The response structure may vary based on SDK version
          let responseText: string | null = null;
          
          if (typeof response.text === 'string') {
            responseText = response.text;
          } else if (response.text) {
            responseText = String(response.text);
          } else if (Array.isArray(response.candidates) && response.candidates[0]?.content?.parts?.[0]?.text) {
            responseText = response.candidates[0].content.parts[0].text;
          } else {
            // Try to extract from the raw response
            const responseString = JSON.stringify(response);
            return {
              ok: false,
              error: createInvalidModelResponseError(
                "Unable to extract text from model response",
                { response: responseString.substring(0, 1000) }
              ),
            };
          }
          
          if (responseText === null || responseText.length === 0) {
            return {
              ok: false,
              error: createInvalidModelResponseError(
                "Model returned empty response"
              ),
            };
          }
          
          // Return the raw response text for validation
          return { ok: true, result: responseText };
          
        } catch (error: unknown) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          // Check if we should retry
          if (retryCount >= this.retryConfig.maxRetries) {
            break;
          }
          
          // Check if error is retryable
          if (this.isRetryableError(lastError)) {
            retryCount++;
            let delay = this.calculateRetryDelay(retryCount);
            const match = lastError.message.match(/retry in (\d+(?:\.\d+)?)\s*s/i) || 
                          lastError.message.match(/retryDelay"?:\s*"(\d+)s"/i);
            if (match) {
              const suggestedSec = parseFloat(match[1]);
              if (!isNaN(suggestedSec) && suggestedSec > 0) {
                delay = Math.min(Math.ceil(suggestedSec * 1000) + 2000, 60000);
              }
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          
          // Non-retryable error, break and return
          break;
        }
      }
      
      // Handle the final error
      if (lastError) {
        if (lastError.name === 'AbortError') {
          return {
            ok: false,
            error: createTimeoutError(
              `Request timed out after ${this.config.timeoutMs}ms`
            ),
          };
        }
        
        const errorMessage = lastError.message || String(lastError);
        const isRetryable = this.isRetryableError(lastError);
        
        return {
          ok: false,
          error: createInvalidModelResponseError(
            isRetryable ? `Retryable error after ${retryCount} retries: ${errorMessage}` : errorMessage,
            { error: lastError, retryCount }
          ),
        };
      }
      
      // Should not reach here
      return {
        ok: false,
        error: createInvalidModelResponseError("Unexpected error in generateContent"),
      };
      
    } finally {
      clearTimeout(timeout);
    }
  }
  
  /**
   * Check if an error is retryable.
   * 
   * @param error - The error to check
   * @returns true if the error is retryable
   */
  private isRetryableError(error: Error): boolean {
    // Check for timeout errors (non-retryable)
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return false;
    }
    
    // Check for authentication errors (non-retryable)
    if (error.message.includes('401') || error.message.includes('403')) {
      return false;
    }
    
    // Check for validation errors (non-retryable)
    if (error.message.includes('400')) {
      return false;
    }
    
    // Check for rate limiting (retryable)
    if (error.message.includes('429')) {
      return true;
    }
    
    // Check for server errors (retryable)
    if (error.message.includes('502') || 
        error.message.includes('503') || 
        error.message.includes('504')) {
      return true;
    }
    
    // Check for network errors (retryable)
    if (error.message.includes('ECONNRESET') || 
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Calculate the delay for a retry attempt.
   * Uses bounded exponential backoff with jitter.
   * 
   * @param retryCount - The current retry count (1-based)
   * @returns The delay in milliseconds
   */
  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff: baseDelay * 2^(retryCount-1)
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, retryCount - 1);
    
    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);
    
    // Add jitter: multiply by (1 - jitter) to (1 + jitter)
    const jitterMultiplier = 1 + 
      (Math.random() * 2 - 1) * this.retryConfig.jitterFactor;
    
    return Math.round(cappedDelay * jitterMultiplier);
  }
  
  /**
   * Validate that the client is properly configured.
   * 
   * @returns true if the client is configured
   */
  isConfigured(): boolean {
    return this.config.apiKey.length >= 16 && 
           this.config.model.length > 0 &&
           this.config.timeoutMs > 0;
  }
}

/**
 * Type guard to check if a value is a GenerateContentResult from @google/genai.
 * This is used for safer type handling.
 */
export function isGenerateContentResult(value: unknown): value is GenerateContentResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    (typeof (value as { text?: unknown }).text === 'string' || 
     typeof (value as { text?: unknown }).text === 'function')
  );
}

/**
 * Extract text from a GenerateContentResult.
 * Handles different SDK versions and response formats.
 * 
 * @param result - The result from generateContent
 * @returns The extracted text or null
 */
export function extractTextFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }
  
  const response = result as GenerateContentResponse;
  
  // Direct text property
  if (typeof response.text === 'string') {
    return response.text;
  }
  
  // Text as a function (legacy SDK support)
  if (typeof (result as any).text === 'function') {
    try {
      const text = (result as any).text();
      if (typeof text === 'string') {
        return text;
      }
    } catch {
      // Ignore
    }
  }
  
  // Try candidates array (v1 API format)
  if (Array.isArray(response.candidates) && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
      const textPart = candidate.content.parts.find(
        (part: any) => typeof part === 'object' && part !== null && 'text' in part
      );
      if (textPart && typeof (textPart as { text?: string }).text === 'string') {
        return (textPart as { text: string }).text;
      }
    }
  }
  
  return null;
}
