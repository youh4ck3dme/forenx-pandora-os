/**
 * PANDORA / ForenX - Middleware Route Classification Tests
 *
 * Tests for route classification logic and path pattern matching.
 */

import { describe, expect, it } from 'vitest';
import {
  matchPathPattern,
  getRouteCategory,
  isInternalPath,
  validateRedirectTarget,
} from '../../../middleware';

describe('matchPathPattern', () => {
  it('matches exact paths', () => {
    expect(matchPathPattern('/auth/login', '/auth/login')).toBe(true);
    expect(matchPathPattern('/forza/pripady', '/forza/pripady')).toBe(true);
    expect(matchPathPattern('/', '/')).toBe(true);
  });

  it('does not match different paths', () => {
    expect(matchPathPattern('/auth/login', '/auth/register')).toBe(false);
    expect(matchPathPattern('/forza', '/browser')).toBe(false);
  });

  it('matches prefix patterns ending with /*', () => {
    expect(matchPathPattern('/forza/pripady', '/forza/*')).toBe(true);
    expect(matchPathPattern('/forza/prehlad', '/forza/*')).toBe(true);
    expect(matchPathPattern('/forza', '/forza/*')).toBe(false); // Exact match, not prefix
  });

  it('matches wildcard segment patterns', () => {
    expect(matchPathPattern('/blog/my-post', '/blog/[...slug]')).toBe(true);
    expect(matchPathPattern('/blog/my-post/sub', '/blog/[...slug]')).toBe(true);
    expect(matchPathPattern('/blog', '/blog/[...slug]')).toBe(false);
  });
});

describe('Route Classification Logic', () => {
  it('identifies PUBLIC routes correctly', () => {
    const publicRoutes = [
      '/auth',
      '/auth/login',
      '/auth/register',
      '/blog',
      '/blog/[...slug]',
      '/forza/stav',
      // PUBLIC API routes
      '/api/csp-report',
      '/api/healthz',
      '/api/health/public',
    ];

    publicRoutes.forEach(route => {
      // All public routes should be internal paths
      expect(isInternalPath(route)).toBe(true);

      const result = getRouteCategory(route);
      expect(result.category).toBe('PUBLIC');
    });
  });

  it('keeps other Forza routes protected', () => {
    expect(getRouteCategory('/forza/stav').category).toBe('PUBLIC');
    expect(getRouteCategory('/forza/stav/').category).toBe('PUBLIC');
    expect(getRouteCategory('/forza/pripady').category).toBe('AUTHENTICATED');
  });

  it('identifies AUTHENTICATED routes correctly', () => {
    const authenticatedRoutes = [
      '/browser',
      '/browser/something',
      '/forge',
      '/forge/studio',
      '/offline',
      '/api/vault',
      '/api/vault/upload',
      '/api/vault/commit',
      '/api/vault/presign',
      '/api/audit',
      '/api/audit/access',
      '/api/health/observe',
      '/api/fn/test',
    ];

    authenticatedRoutes.forEach(route => {
      const result = getRouteCategory(route);
      expect(result.category).toBe('AUTHENTICATED');
    });
  });

  it('identifies SYSTEM routes correctly', () => {
    const systemRoutes = [
      '/healthz',
      '/api/vault/verify',
      '/.well-known/security.txt',
    ];

    systemRoutes.forEach(route => {
      const result = getRouteCategory(route);
      expect(result.category).toBe('SYSTEM');
    });
  });

  it('identifies API routes that need protection', () => {
    const protectedApiRoutes = [
      '/api/vault',
      '/api/vault/*',
      '/api/audit',
      '/api/audit/*',
      '/api/fn',
      '/api/fn/*',
    ];

    protectedApiRoutes.forEach(route => {
      const result = getRouteCategory(route);
      // These should be AUTHENTICATED or PROJECT_REQUIRED
      expect(['AUTHENTICATED', 'PROJECT_REQUIRED'].includes(result.category)).toBe(true);
    });
  });
});

describe('Open Redirect Protection Edge Cases', () => {
  it('handles encoded malicious URLs', () => {
    expect(matchPathPattern('/auth/login', '%2Fauth%2Flogin')).toBe(false);
    expect(validateRedirectTarget('/auth/login%2Fevil')).toBeNull();
  });

  it('handles mixed case paths', () => {
    expect(validateRedirectTarget('/FORZA/pripady')).toBe('/FORZA/pripady');
    expect(validateRedirectTarget('/Forza/Pripady')).toBe('/Forza/Pripady');
  });

  it('handles paths with multiple query parameters', () => {
    expect(validateRedirectTarget('/forza/pripady?case=1&tab=2')).toBe('/forza/pripady?case=1&tab=2');
    expect(validateRedirectTarget('/auth/login?next=/forza&test=1')).toBe('/auth/login?next=/forza&test=1');
  });

  it('handles empty strings', () => {
    expect(validateRedirectTarget('')).toBeNull();
    expect(validateRedirectTarget('   ')).toBeNull();
  });

  it('handles paths with only query strings', () => {
    expect(validateRedirectTarget('?next=/forza')).toBeNull();
    expect(validateRedirectTarget('?param=value')).toBeNull();
  });
});

