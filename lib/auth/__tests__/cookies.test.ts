import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setAuthCookies, clearAuthCookies, syncAuthCookies } from '../cookies';

describe('Client Auth Cookie Synchronization (Server Bridge)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls POST /api/auth/session with Bearer token and body', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200 });

    const success = await setAuthCookies({
      access_token: 'fake.jwt.token',
      refresh_token: 'fake-refresh-token',
      expires_in: 3600,
    });

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/session/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer fake.jwt.token',
      },
      body: JSON.stringify({
        access_token: 'fake.jwt.token',
        refresh_token: 'fake-refresh-token',
        expires_in: 3600,
      }),
      credentials: 'same-origin',
    });
  });

  it('calls DELETE /api/auth/session on clearAuthCookies', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200 });

    const success = await clearAuthCookies();

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/session/', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  });

  it('syncs cookies when session is provided or absent', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

    const setSuccess = await syncAuthCookies({
      access_token: 'active-token',
      refresh_token: 'active-refresh',
    });
    expect(setSuccess).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/session/', expect.objectContaining({ method: 'POST' }));

    const clearSuccess = await syncAuthCookies(null);
    expect(clearSuccess).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/session/', expect.objectContaining({ method: 'DELETE' }));
  });
});
