import { describe, it, expect, beforeEach } from 'vitest';
import { setAuthCookies, clearAuthCookies, syncAuthCookies } from '../cookies';

describe('Client Auth Cookie Synchronization', () => {
  beforeEach(() => {
    // Clear all cookies in jsdom
    document.cookie.split(';').forEach((cookie) => {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });
  });

  it('sets sb-access-token and sb-refresh-token correctly in document.cookie', () => {
    setAuthCookies({
      access_token: 'fake.jwt.token',
      refresh_token: 'fake-refresh-token',
      expires_in: 3600,
    });

    expect(document.cookie).toContain('sb-access-token=fake.jwt.token');
    expect(document.cookie).toContain('sb-refresh-token=fake-refresh-token');
  });

  it('clears cookies on clearAuthCookies', () => {
    setAuthCookies({
      access_token: 'fake.jwt.token',
      refresh_token: 'fake-refresh-token',
    });
    expect(document.cookie).toContain('sb-access-token=fake.jwt.token');

    clearAuthCookies();
    expect(document.cookie).not.toContain('sb-access-token=fake.jwt.token');
    expect(document.cookie).not.toContain('sb-refresh-token=fake-refresh-token');
  });

  it('syncs cookies when session is provided or absent', () => {
    syncAuthCookies({
      access_token: 'active-token',
      refresh_token: 'active-refresh',
    });
    expect(document.cookie).toContain('sb-access-token=active-token');

    syncAuthCookies(null);
    expect(document.cookie).not.toContain('sb-access-token=active-token');
  });
});
