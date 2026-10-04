import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, DELETE } from '../../../app/api/auth/session/route';

// Mock rate limiter
vi.mock('@/lib/security/rate-limiter.server', () => ({
  getRateLimiter: () => ({
    hit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29 }),
  }),
}));

// Mock Supabase client
const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

describe('Session Bridge API (/api/auth/session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';
  });

  describe('POST /api/auth/session', () => {
    it('rejects cross-origin requests with 403', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'https://evil-attacker.com',
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Forbidden');
    });

    it('returns 401 when no token is provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain('Missing access token');
    });

    it('returns 401 when token is rejected by Supabase Auth', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid JWT' },
      });

      const request = new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          authorization: 'Bearer bad.token.here',
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain('Invalid or expired session token');
    });

    it('sets HttpOnly cookies and returns user profile without exposing token', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-uuid-123',
            email: 'investigator@forenx.org',
          },
        },
        error: null,
      });

      const request = new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          authorization: 'Bearer valid.jwt.token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: 'valid.refresh.token',
          expires_in: 7200,
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.user).toEqual({
        id: 'user-uuid-123',
        email: 'investigator@forenx.org',
      });
      // Blueprint invariant: NO token returned in response body
      expect(data.access_token).toBeUndefined();
      expect(data.token).toBeUndefined();

      // Check cookies
      const accessCookie = response.cookies.get('sb-access-token');
      expect(accessCookie).toBeDefined();
      expect(accessCookie?.value).toBe('valid.jwt.token');
      expect(accessCookie?.httpOnly).toBe(true);
      expect(accessCookie?.sameSite).toBe('lax');
      expect(accessCookie?.maxAge).toBe(7200);

      const refreshCookie = response.cookies.get('sb-refresh-token');
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.value).toBe('valid.refresh.token');
      expect(refreshCookie?.httpOnly).toBe(true);
    });
  });

  describe('DELETE /api/auth/session', () => {
    it('clears session cookies on logout', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/session', {
        method: 'DELETE',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
        },
      });

      const response = await DELETE(request);
      expect(response.status).toBe(200);

      const accessCookie = response.cookies.get('sb-access-token');
      expect(accessCookie).toBeDefined();
      expect(accessCookie?.maxAge).toBe(0);

      const refreshCookie = response.cookies.get('sb-refresh-token');
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.maxAge).toBe(0);
    });
  });
});
