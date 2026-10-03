import { describe, expect, it } from 'vitest';
import {
    getRouteCategory,
    isInternalPath,
    matchPathPattern,
    validateRedirectTarget,
    type RouteCategory,
} from '../../middleware';

describe('Route Classification Contract & Middleware Authorization', () => {
  describe('PUBLIC Route Classification', () => {
    const publicRoutes = [
      '/',
      '/auth',
      '/auth/login',
      '/auth/register',
      '/blog',
      '/blog/forensic-guide',
      '/forza/stav',
      '/api/csp-report',
      '/api/csp-report/ingest',
      '/api/healthz',
      '/api/healthz/liveness',
    ];

    for (const route of publicRoutes) {
      it(`correctly classifies ${route} as PUBLIC`, () => {
        const { category } = getRouteCategory(route);
        expect(category).toBe<RouteCategory>('PUBLIC');
      });
    }
  });

  describe('SYSTEM Route Classification', () => {
    const systemRoutes = [
      '/healthz',
      '/healthz/ready',
      '/api/vault/verify',
      '/.well-known/security.txt',
    ];

    for (const route of systemRoutes) {
      it(`correctly classifies ${route} as SYSTEM`, () => {
        const { category } = getRouteCategory(route);
        expect(category).toBe<RouteCategory>('SYSTEM');
      });
    }
  });

  describe('Forza Protected Route Classification (AUTHENTICATED)', () => {
    const projectRoutes = [
      '/forza',
      '/forza/prehlad',
      '/forza/asistent',
      '/forza/vztahy',
      '/forza/siet',
      '/forza/pripady',
      '/forza/sandbox',
      '/forza/profil',
      '/forza/predplatne',
    ];

    for (const route of projectRoutes) {
      it(`correctly classifies ${route} as AUTHENTICATED`, () => {
        const { category } = getRouteCategory(route);
        expect(category).toBe<RouteCategory>('AUTHENTICATED');
      });
    }
  });

  describe('AUTHENTICATED Route Classification', () => {
    const authenticatedRoutes = [
      '/browser',
      '/forge',
      '/forge/project-1',
      '/offline',
      '/api/vault',
      '/api/vault/presign',
      '/api/audit',
      '/api/audit/access',
      '/api/health/observe',
      '/api/fn',
      '/api/fn/invoke',
      '/prehlad',
      '/asistent',
      '/vztahy',
      '/workspace',
      '/cases',
      '/profile',
      '/settings',
      '/export',
    ];

    for (const route of authenticatedRoutes) {
      it(`correctly classifies ${route} as AUTHENTICATED`, () => {
        const { category } = getRouteCategory(route);
        expect(category).toBe<RouteCategory>('AUTHENTICATED');
      });
    }
  });

  describe('Safe Redirect & Open Redirect Protection Contract', () => {
    it('accepts safe internal paths with queries', () => {
      expect(validateRedirectTarget('/forza/prehlad')).toBe('/forza/prehlad');
      expect(validateRedirectTarget('/prehlad')).toBe('/prehlad');
      expect(validateRedirectTarget('/asistent')).toBe('/asistent');
      expect(validateRedirectTarget('/vztahy')).toBe('/vztahy');
      expect(validateRedirectTarget('/forza/pripady?case=123')).toBe('/forza/pripady?case=123');
      expect(validateRedirectTarget('/auth/login')).toBe('/auth/login');
    });

    it('rejects external URLs (http/https/protocol-relative)', () => {
      expect(validateRedirectTarget('https://evil.example')).toBeNull();
      expect(validateRedirectTarget('http://attacker.com/malicious')).toBeNull();
      expect(validateRedirectTarget('//evil.example/forza')).toBeNull();
    });

    it('rejects script injections and data URIs', () => {
      expect(validateRedirectTarget('javascript:alert(1)')).toBeNull();
      expect(validateRedirectTarget('javascript://attacker.com/%0Aalert(1)')).toBeNull();
      expect(validateRedirectTarget('data:text/html,<script>alert(1)</script>')).toBeNull();
    });

    it('rejects directory traversal and double-slash evasion', () => {
      expect(validateRedirectTarget('/forza/../admin')).toBeNull();
      expect(validateRedirectTarget('/forza//pripady')).toBeNull();
      expect(validateRedirectTarget('/forza%2Fevil')).toBeNull();
      expect(validateRedirectTarget('/forza%5Cevil')).toBeNull();
      expect(validateRedirectTarget('/forza%00evil')).toBeNull();
    });

    it('identifies internal vs external path prefixes correctly', () => {
      expect(isInternalPath('/')).toBe(true);
      expect(isInternalPath('/forza')).toBe(true);
      expect(isInternalPath('/forza/prehlad')).toBe(true);
      expect(isInternalPath('/browser')).toBe(true);
      expect(isInternalPath('/api/vault')).toBe(true);
      expect(isInternalPath('https://whoiswho.at')).toBe(false);
      expect(isInternalPath('//whoiswho.at')).toBe(false);
    });
  });

  describe('Pattern Matching Logic', () => {
    it('supports exact, prefix, and wildcard matching', () => {
      expect(matchPathPattern('/auth', '/auth')).toBe(true);
      expect(matchPathPattern('/forza/sub', '/forza/*')).toBe(true);
      expect(matchPathPattern('/forza', '/forza/*')).toBe(false);
      expect(matchPathPattern('/blog/intro', '/blog/[...slug]')).toBe(true);
      expect(matchPathPattern('/blog/intro/part2', '/blog/[...slug]')).toBe(true);
    });
  });
});
