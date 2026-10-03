/**
 * PANDORA / ForenX - Middleware Behavior Tests
 *
 * Tests to verify:
 * 1. Middleware returns 401 JSON for unauthenticated API routes
 * 2. Middleware redirects to login for unauthenticated page routes
 * 3. Public routes pass through without auth
 * 4. Open redirect protection works
 */

import { describe, test, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../../middleware';

// Mock Supabase client to avoid actual network calls
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'No session' } }),
    },
  }),
}));

// Helper to invoke middleware with optional NextFetchEvent stub
const callMiddleware = (request: NextRequest) =>
  (middleware as (req: NextRequest, event?: any) => Promise<any>)(request, {} as any);

// ============================================================================
// CORE MIDDLEWARE BEHAVIOR TESTS
// ============================================================================

describe('Middleware - API Routes Return 401 JSON', () => {
  test.each([
    '/api/vault',
    '/api/vault/commit',
    '/api/vault/presign',
    '/api/audit/access',
    '/api/fn/some-function',
    '/api/new-route', // Unclassified API route
  ])('returns 401 JSON for %s without session', async (path) => {
    const request = new NextRequest(`http://localhost${path}`, {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // API routes should return 401 JSON, not redirect
    expect(response?.status).toBe(401);

    const json = await response?.json();
    expect(json?.error).toContain('Unauthorized');
  });
});

describe('Middleware - Public API Routes Pass Through', () => {
  test.each([
    '/api/healthz',
    '/api/csp-report',
    '/api/health/public',
  ])('allows %s without session (PUBLIC)', async (path) => {
    const request = new NextRequest(`http://localhost${path}`, {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // PUBLIC routes should NOT return 401
    // They pass through to the route handler
    expect(response?.status).not.toBe(401);
  });
});

describe('Middleware - Machine-to-Machine Routes Pass Through', () => {
  test('allows /api/vault/verify without user session (SYSTEM)', async () => {
    const request = new NextRequest('http://localhost/api/vault/verify', {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // SYSTEM routes should NOT return 401
    // They pass through to the route handler which checks CRON_SECRET
    expect(response?.status).not.toBe(401);
  });
});

describe('Middleware - Page Routes Redirect to Login', () => {
  test.each([
    '/forza',
    '/forza/pripady',
    '/browser',
    '/forge',
  ])('redirects %s to login without session', async (path) => {
    const request = new NextRequest(`http://localhost${path}`, {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // Page routes should redirect to login
    expect(response?.status).toBe(307); // Temporary Redirect
    expect(response?.headers.get('location')).toContain('/auth');
  });

  test('preserves safe redirect target', async () => {
    const request = new NextRequest('http://localhost/forza/pripady?tab=1', {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    expect(response?.status).toBe(307);
    const location = response?.headers.get('location');
    expect(location).toContain('/auth');
    expect(location).toContain('next=');
  });

  test('rejects external redirect targets', async () => {
    const request = new NextRequest('http://localhost/forza?next=https://evil.com', {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    expect(response?.status).toBe(307);
    const location = response?.headers.get('location');
    // Should redirect to /auth WITHOUT the malicious next param
    // Location header contains full URL, so check it ends with /auth
    expect(location).toContain('/auth');
    expect(location).not.toContain('next=');
  });
});

describe('Middleware - Public Page Routes Pass Through', () => {
  test.each([
    '/auth',
    '/auth/login',
    '/auth/register',
    '/blog',
  ])('allows %s without session', async (path) => {
    const request = new NextRequest(`http://localhost${path}`, {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // PUBLIC routes should NOT return 401 or redirect
    expect(response?.status).not.toBe(401);
    expect(response?.status).not.toBe(307);
  });

  test('redirects unauthenticated root / to /auth/login/?next=%2Fbrowser%2F (Blueprint P2)', async () => {
    const request = new NextRequest('http://localhost/', {
      method: 'GET',
    });
    const response = await callMiddleware(request);
    expect(response?.status).toBe(307);
    const location = response?.headers.get('location');
    expect(location).toContain('/auth/login');
    expect(location).toContain('next=%2Fbrowser%2F');
  });
});

describe('Middleware - Project Required Routes', () => {
  test('redirects /forza to login without session', async () => {
    const request = new NextRequest('http://localhost/forza', {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // Should redirect to login (no session)
    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toContain('/auth');
  });
});

// ============================================================================
// STATUS CODE CONSISTENCY
// ============================================================================

describe('Status Code Consistency', () => {
  test('API routes return 401, not 302/307', async () => {
    const request = new NextRequest('http://localhost/api/vault', {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // API routes should NEVER redirect (302/307)
    expect(response?.status).toBe(401);
    expect(response?.status).not.toBe(302);
    expect(response?.status).not.toBe(307);
  });

  test('Page routes return 307 redirect, not 401', async () => {
    const request = new NextRequest('http://localhost/forza', {
      method: 'GET',
    });

    const response = await callMiddleware(request);

    // Page routes should redirect, not return 401
    expect(response?.status).toBe(307);
    expect(response?.status).not.toBe(401);
  });
});


describe('Middleware - Root Route Invariant (Blueprint P2)', () => {
  test('redirects unauthenticated / to /auth/login/?next=%2Fbrowser%2F', async () => {
    const request = new NextRequest('http://localhost/', {
      method: 'GET',
    });

    const response = await callMiddleware(request);
    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toContain('/auth/login/?next=%2Fbrowser%2F');
  });
});

describe('Middleware - Explicit Bearer Token Precedence (Blueprint P2)', () => {
  test('fails closed with 401 on invalid Bearer token for API route', async () => {
    const request = new NextRequest('http://localhost/api/vault', {
      method: 'GET',
      headers: {
        authorization: 'Bearer invalid.token.payload',
      },
    });

    const response = await callMiddleware(request);
    expect(response?.status).toBe(401);
  });
});

describe('Middleware - Session Refresh Cookies Are HttpOnly (R-3)', () => {
  test('middleware source sets httpOnly: true on refresh cookies', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../middleware.ts'),
      'utf8',
    );
    const refreshBlock = src.slice(src.indexOf('if (refreshedSession)'));
    const matches = [...refreshBlock.matchAll(/httpOnly:\s*true/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Canonical Redirect Validator (R-2)', () => {
  test('middleware re-exports isInternalPath and validateRedirectTarget from lib/auth/redirect', async () => {
    const middlewareModule = await import('../../../middleware');
    const redirectModule = await import('../redirect');
    expect(middlewareModule.isInternalPath).toBe(redirectModule.isInternalPath);
    expect(middlewareModule.validateRedirectTarget).toBe(redirectModule.validateRedirectTarget);
  });
});

describe('Auth Architecture - Circular Import Prevention (R-5)', () => {
  test('lib/auth/index.ts does not import from middleware', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf8',
    );
    expect(src).not.toContain('@/middleware');
    expect(src).not.toContain("from '../middleware'");
    expect(src).not.toContain('from "../../middleware"');
  });
});

describe('Middleware - Fail-Closed devAuthBypassAllowed (R-1)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('returns false in production even if ALLOW_DEV_AUTH_BYPASS is true', async () => {
    const { devAuthBypassAllowed } = await import('../../../middleware');
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
    const req = new NextRequest('http://localhost:3000/forza');
    expect(devAuthBypassAllowed(req)).toBe(false);
  });

  test('returns false when ALLOW_DEV_AUTH_BYPASS is not true', async () => {
    const { devAuthBypassAllowed } = await import('../../../middleware');
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_DEV_AUTH_BYPASS;
    const req = new NextRequest('http://localhost:3000/forza');
    expect(devAuthBypassAllowed(req)).toBe(false);
  });

  test('returns false on Vercel', async () => {
    const { devAuthBypassAllowed } = await import('../../../middleware');
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
    process.env.VERCEL = '1';
    const req = new NextRequest('http://localhost:3000/forza');
    expect(devAuthBypassAllowed(req)).toBe(false);
  });

  test('returns false when real evidence access keys are present', async () => {
    const { devAuthBypassAllowed } = await import('../../../middleware');
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
    delete process.env.VERCEL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-service-key';
    const req = new NextRequest('http://localhost:3000/forza');
    expect(devAuthBypassAllowed(req)).toBe(false);
  });

  test('returns false for non-loopback hostname', async () => {
    const { devAuthBypassAllowed } = await import('../../../middleware');
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
    delete process.env.VERCEL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const req = new NextRequest('https://evil.example.com/forza');
    expect(devAuthBypassAllowed(req)).toBe(false);
  });
});

