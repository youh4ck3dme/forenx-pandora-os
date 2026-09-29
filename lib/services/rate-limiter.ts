/**
 * P0-09: Rate Limiting - Atomic PostgreSQL-based implementation for serverless environments
 *
 * Production-safe rate limiting using Supabase PostgreSQL atomic RPC operations.
 * 
 * Key invariants:
 * - Production: Uses atomic consume_rate_limit() RPC - no separate GET/SET
 * - Production: Fails closed if RPC unavailable, table missing, or any database error
 * - Development: Uses process-local Map (not shared across instances)
 * - No silent fallback to per-instance storage in production
 * - Concurrent requests across serverless instances cannot bypass limits
 * - Stored window semantics: window starts at first request, resets after window duration
 */

// ============================================================================
// Types
// ============================================================================

/** Distinguishable rate limit reasons */
export type RateLimitReason = 'LIMIT_EXCEEDED' | 'RATE_LIMITER_UNAVAILABLE' | 'ALLOWED';

/** Result of a rate limit check */
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp in milliseconds
  reason: RateLimitReason;
};

/** Configuration for a rate limiter */
export type RateLimiterConfig = {
  maxRequests: number;
  windowMs: number;
  failClosedInProduction?: boolean;
  keyPrefix?: string;
};

// ============================================================================
// Default Configurations
// ============================================================================

export const CSP_REPORT_LIMIT_CONFIG: RateLimiterConfig = {
  maxRequests: 20,
  windowMs: 60_000,
  failClosedInProduction: true,
  keyPrefix: 'csp_report',
};

export const HEALTH_OBSERVE_LIMIT_CONFIG: RateLimiterConfig = {
  maxRequests: 10,
  windowMs: 60_000,
  failClosedInProduction: true,
  keyPrefix: 'health_observe',
};

// ============================================================================
// Storage Interface
// ============================================================================

interface RateLimitStorage {
  consumeRateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult | null>;
  checkRateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult | null>;
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Process-Local Storage (Development Only)
// ============================================================================

class ProcessLocalRateLimitStorage implements RateLimitStorage {
  private store = new Map<string, { count: number; windowStart: number }>();

  async isAvailable(): Promise<boolean> {
    return process.env.NODE_ENV !== 'production';
  }

  async consumeRateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.store.get(key);
    
    let newCount: number;
    let effectiveWindowStart: number;
    
    if (!existing) {
      // No record: start new window with count=1
      newCount = 1;
      effectiveWindowStart = now;
    } else {
      const windowEnd = existing.windowStart + windowMs;
      if (now >= windowEnd) {
        // Window expired: reset to new window with count=1
        newCount = 1;
        effectiveWindowStart = now;
      } else {
        // Same window: increment
        newCount = existing.count + 1;
        effectiveWindowStart = existing.windowStart;
      }
    }
    
    const allowed = newCount <= maxRequests;
    const remaining = allowed ? Math.max(0, maxRequests - newCount) : 0;
    const resetAt = effectiveWindowStart + windowMs;
    const reason: RateLimitReason = allowed ? 'ALLOWED' : 'LIMIT_EXCEEDED';
    
    this.store.set(key, { count: newCount, windowStart: effectiveWindowStart });
    return { allowed, remaining, resetAt, reason };
  }

  async checkRateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.store.get(key);
    
    let effectiveCount: number;
    let effectiveWindowStart: number;
    
    if (!existing) {
      effectiveCount = 0;
      effectiveWindowStart = now;
    } else {
      const windowEnd = existing.windowStart + windowMs;
      if (now >= windowEnd) {
        effectiveCount = 0;
        effectiveWindowStart = now;
      } else {
        effectiveCount = existing.count;
        effectiveWindowStart = existing.windowStart;
      }
    }
    
    const allowed = effectiveCount < maxRequests;
    const remaining = allowed ? Math.max(0, maxRequests - effectiveCount) : 0;
    const resetAt = effectiveWindowStart + windowMs;
    const reason: RateLimitReason = allowed ? 'ALLOWED' : 'LIMIT_EXCEEDED';
    
    return { allowed, remaining, resetAt, reason };
  }

  clear(): void {
    this.store.clear();
  }
}

const processLocalStorage = new ProcessLocalRateLimitStorage();

// ============================================================================
// Supabase Atomic Storage (Production)
// ============================================================================

type SupabaseRPCResult = { allowed: boolean; remaining: number; reset_at: string };

class SupabaseAtomicRateLimitStorage implements RateLimitStorage {
  private supabaseClient: any = null;
  private clientPromise: Promise<any> | null = null;

  async isAvailable(): Promise<boolean> {
    const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const hasSupabaseKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    if (!hasSupabaseUrl || !hasSupabaseKey) {
      return false;
    }

    try {
      const client = await this.getClient();
      const { error } = await client.rpc('check_rate_limit', {
        p_key: `__healthcheck_${Date.now()}`,
        p_max_requests: 1,
        p_window_seconds: 60,
      });
      return !error;
    } catch {
      return false;
    }
  }

  private async getClient(): Promise<any> {
    if (this.supabaseClient) return this.supabaseClient;
    if (this.clientPromise) return this.clientPromise;
    
    this.clientPromise = (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      return createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    })();

    return this.clientPromise;
  }

  resetClient(): void {
    this.supabaseClient = null;
    this.clientPromise = null;
  }

  async consumeRateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult | null> {
    try {
      const client = await this.getClient();
      const { data, error } = await client.rpc('consume_rate_limit', {
        p_key: key,
        p_max_requests: maxRequests,
        p_window_seconds: Math.floor(windowMs / 1000),
      });
      if (error || !data || data.length === 0) return null;
      const result = data[0] as SupabaseRPCResult;
      const reason: RateLimitReason = result.allowed ? 'ALLOWED' : 'LIMIT_EXCEEDED';
      return {
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: new Date(result.reset_at).getTime(),
        reason,
      };
    } catch {
      return null;
    }
  }

  async checkRateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult | null> {
    try {
      const client = await this.getClient();
      const { data, error } = await client.rpc('check_rate_limit', {
        p_key: key,
        p_max_requests: maxRequests,
        p_window_seconds: Math.floor(windowMs / 1000),
      });
      if (error || !data || data.length === 0) return null;
      const result = data[0] as SupabaseRPCResult;
      const reason: RateLimitReason = result.allowed ? 'ALLOWED' : 'LIMIT_EXCEEDED';
      return {
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: new Date(result.reset_at).getTime(),
        reason,
      };
    } catch {
      return null;
    }
  }
}

const supabaseAtomicStorage = new SupabaseAtomicRateLimitStorage();

// ============================================================================
// Storage Selection
// ============================================================================

function getStorage(): RateLimitStorage {
  if (process.env.NODE_ENV === 'production') {
    return supabaseAtomicStorage;
  }
  return processLocalStorage;
}

// ============================================================================
// Shared Rate Limiter
// ============================================================================

/**
 * Distinguishable result types for rate limiting
 */
export type RateLimitStatus = RateLimitResult & {
  limiterUnavailable?: boolean;
};

export class SharedRateLimiter {
  private config: RateLimiterConfig;
  constructor(config: RateLimiterConfig) { this.config = config; }

  /**
   * Sanitize and normalize rate limit key to prevent abuse.
   * Bounds length to 250 chars, truncates if needed.
   */
  private sanitizeKey(key: string): string {
    if (typeof key !== 'string') return 'invalid';
    return key.slice(0, 250);
  }

  private getFullKey(key: string): string {
    const sanitized = this.sanitizeKey(key);
    const prefix = this.config.keyPrefix ? `${this.config.keyPrefix}:` : '';
    return `rate_limit:${prefix}${sanitized}`;
  }

  /**
   * Check and consume a rate limit slot.
   * Returns allowed/denied with remaining count and reset time.
   * In production: fails closed if storage unavailable.
   */
  async check(key: string): Promise<RateLimitResult> {
    const fullKey = this.getFullKey(key);
    const storage = getStorage();
    const isProduction = process.env.NODE_ENV === 'production';
    const failClosed = this.config.failClosedInProduction;
    
    if (isProduction && failClosed) {
      const storageAvailable = await storage.isAvailable();
      if (!storageAvailable) {
        return { allowed: false, remaining: 0, resetAt: Date.now() + this.config.windowMs, reason: 'RATE_LIMITER_UNAVAILABLE' };
      }
    }
    
    const result = await storage.consumeRateLimit(fullKey, this.config.maxRequests, this.config.windowMs);
    
    if (result !== null) return result;
    
    if (isProduction && failClosed) {
      return { allowed: false, remaining: 0, resetAt: Date.now() + this.config.windowMs, reason: 'RATE_LIMITER_UNAVAILABLE' };
    }
    
    return { allowed: true, remaining: this.config.maxRequests, resetAt: Date.now() + this.config.windowMs, reason: 'ALLOWED' };
  }

  async isAllowed(key: string): Promise<boolean> {
    const result = await this.check(key);
    return result.allowed;
  }

  /**
   * Check rate limit status WITHOUT consuming.
   * In production: fails closed if storage unavailable.
   */
  async checkStatus(key: string): Promise<RateLimitResult> {
    const fullKey = this.getFullKey(key);
    const storage = getStorage();
    const isProduction = process.env.NODE_ENV === 'production';
    const failClosed = this.config.failClosedInProduction;
    
    if (isProduction && failClosed) {
      const storageAvailable = await storage.isAvailable();
      if (!storageAvailable) {
        return { allowed: false, remaining: 0, resetAt: Date.now() + this.config.windowMs, reason: 'RATE_LIMITER_UNAVAILABLE' };
      }
    }
    
    const result = await storage.checkRateLimit(fullKey, this.config.maxRequests, this.config.windowMs);
    
    if (result !== null) return result;
    
    if (isProduction && failClosed) {
      return { allowed: false, remaining: 0, resetAt: Date.now() + this.config.windowMs, reason: 'RATE_LIMITER_UNAVAILABLE' };
    }
    
    return { allowed: true, remaining: this.config.maxRequests, resetAt: Date.now() + this.config.windowMs, reason: 'ALLOWED' };
  }

  async reset(_key: string): Promise<void> {
    if (process.env.NODE_ENV !== 'production') processLocalStorage.clear();
  }
  async resetAll(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') processLocalStorage.clear();
  }
}

// ============================================================================
// Lazy Limiter Initialization
// ============================================================================

let cspReportLimiterInstance: SharedRateLimiter | null = null;
let healthObserveLimiterInstance: SharedRateLimiter | null = null;
let lastNodeEnv: string | undefined = undefined;

function clearLimiterCache(): void {
  cspReportLimiterInstance = null;
  healthObserveLimiterInstance = null;
  lastNodeEnv = undefined;
  supabaseAtomicStorage.resetClient();
}

function getCspReportLimiter(): SharedRateLimiter {
  const currentEnv = process.env.NODE_ENV;
  if (lastNodeEnv !== currentEnv) { clearLimiterCache(); lastNodeEnv = currentEnv; }
  if (!cspReportLimiterInstance) cspReportLimiterInstance = new SharedRateLimiter(CSP_REPORT_LIMIT_CONFIG);
  return cspReportLimiterInstance;
}

function getHealthObserveLimiter(): SharedRateLimiter {
  const currentEnv = process.env.NODE_ENV;
  if (lastNodeEnv !== currentEnv) { clearLimiterCache(); lastNodeEnv = currentEnv; }
  if (!healthObserveLimiterInstance) healthObserveLimiterInstance = new SharedRateLimiter(HEALTH_OBSERVE_LIMIT_CONFIG);
  return healthObserveLimiterInstance;
}

/** Rate limiter for CSP report endpoint. */
export const cspReportLimiter: SharedRateLimiter = new Proxy({} as SharedRateLimiter, {
  get(_target, prop) {
    const limiter = getCspReportLimiter();
    const value = limiter[prop as keyof SharedRateLimiter];
    return typeof value === 'function' ? value.bind(limiter) : value;
  },
}) as unknown as SharedRateLimiter;

/** Rate limiter for health observe endpoint. */
export const healthObserveLimiter: SharedRateLimiter = new Proxy({} as SharedRateLimiter, {
  get(_target, prop) {
    const limiter = getHealthObserveLimiter();
    const value = limiter[prop as keyof SharedRateLimiter];
    return typeof value === 'function' ? value.bind(limiter) : value;
  },
}) as unknown as SharedRateLimiter;

// Export for testing
export { processLocalStorage, supabaseAtomicStorage, clearLimiterCache };

export async function resetAllRateLimiters(): Promise<void> {
  await cspReportLimiter.resetAll();
  await healthObserveLimiter.resetAll();
  processLocalStorage.clear();
}
