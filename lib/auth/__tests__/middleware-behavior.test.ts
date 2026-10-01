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
import { middleware } from '@/middleware';

// Mock Supabase client to avoid actual network calls
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'No session' } }),
    },
  }),
}));

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

    const response = await middleware(request);

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

    const response = await middleware(request);

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

    const response = await middleware(request);

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

    const response = await middleware(request);

    // Page routes should redirect to login
    expect(response?.status).toBe(307); // Temporary Redirect
    expect(response?.headers.get('location')).toContain('/auth');
  });

  test('preserves safe redirect target', async () => {
    const request = new NextRequest('http://localhost/forza/pripady?tab=1', {
      method: 'GET',
    });

    const response = await middleware(request);

    expect(response?.status).toBe(307);
    const location = response?.headers.get('location');
    expect(location).toContain('/auth');
    expect(location).toContain('next=');
  });

  test('rejects external redirect targets', async () => {
    const request = new NextRequest('http://localhost/forza?next=https://evil.com', {
      method: 'GET',
    });

    const response = await middleware(request);

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
    '/',
    '/auth',
    '/auth/login',
    '/auth/register',
    '/blog',
    '/forza/stav',
  ])('allows %s without session', async (path) => {
    const request = new NextRequest(`http://localhost${path}`, {
      method: 'GET',
    });

    const response = await middleware(request);

    // PUBLIC routes should NOT return 401 or redirect
    expect(response?.status).not.toBe(401);
    expect(response?.status).not.toBe(307);
  });
});

describe('Middleware - Project Required Routes', () => {
  test('redirects /forza to login without session', async () => {
    const request = new NextRequest('http://localhost/forza', {
      method: 'GET',
    });

    const response = await middleware(request);

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

    const response = await middleware(request);

    // API routes should NEVER redirect (302/307)
    expect(response?.status).toBe(401);
    expect(response?.status).not.toBe(302);
    expect(response?.status).not.toBe(307);
  });

  test('Page routes return 307 redirect, not 401', async () => {
    const request = new NextRequest('http://localhost/forza', {
      method: 'GET',
    });

    const response = await middleware(request);

    // Page routes should redirect, not return 401
    expect(response?.status).toBe(307);
    expect(response?.status).not.toBe(401);
  });
});
