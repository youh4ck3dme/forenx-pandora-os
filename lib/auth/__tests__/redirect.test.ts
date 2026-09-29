/**
 * PANDORA / ForenX - Redirect Protection Tests
 * 
 * Tests for open redirect protection utilities.
 */

import { describe, expect, it } from 'vitest';
import {
  isInternalPath,
  validateRedirectTarget,
  getSafeRedirectTarget,
  getLoginRedirectUrl,
} from '../redirect';

describe('isInternalPath', () => {
  it('returns true for root path', () => {
    expect(isInternalPath('/')).toBe(true);
  });

  it('returns true for internal application paths', () => {
    expect(isInternalPath('/forza')).toBe(true);
    expect(isInternalPath('/forza/pripady')).toBe(true);
    expect(isInternalPath('/forza/pripady?tab=1')).toBe(true);
    expect(isInternalPath('/browser')).toBe(true);
    expect(isInternalPath('/forge')).toBe(true);
    expect(isInternalPath('/forge/studio')).toBe(true);
    expect(isInternalPath('/offline')).toBe(true);
    expect(isInternalPath('/auth')).toBe(true);
    expect(isInternalPath('/auth/login')).toBe(true);
  });

  it('returns false for absolute URLs', () => {
    expect(isInternalPath('https://evil.com')).toBe(false);
    expect(isInternalPath('http://evil.com')).toBe(false);
    expect(isInternalPath('//evil.com')).toBe(false);
    expect(isInternalPath('https://pandora.whoiswho.at')).toBe(false);
  });

  it('returns false for protocol-relative URLs', () => {
    expect(isInternalPath('//evil.com/path')).toBe(false);
  });

  it('returns false for external paths', () => {
    expect(isInternalPath('/external')).toBe(false);
    expect(isInternalPath('/api/external')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isInternalPath(null)).toBe(false);
    expect(isInternalPath(undefined)).toBe(false);
  });

  it('handles paths with query strings', () => {
    expect(isInternalPath('/forza/pripady?case=123&tab=details')).toBe(true);
    expect(isInternalPath('/auth/login?next=/forza')).toBe(true);
  });

  it('handles paths with hash', () => {
    expect(isInternalPath('/forza/pripady#section')).toBe(true);
  });
});

describe('validateRedirectTarget', () => {
  it('returns the same path for valid internal paths', () => {
    expect(validateRedirectTarget('/forza/pripady')).toBe('/forza/pripady');
    expect(validateRedirectTarget('/browser')).toBe('/browser');
    expect(validateRedirectTarget('/')).toBe('/');
  });

  it('preserves query strings for internal paths', () => {
    expect(validateRedirectTarget('/forza/pripady?tab=1')).toBe('/forza/pripady?tab=1');
    expect(validateRedirectTarget('/auth/login?next=/forza')).toBe('/auth/login?next=/forza');
  });

  it('returns null for absolute URLs', () => {
    expect(validateRedirectTarget('https://evil.com')).toBeNull();
    expect(validateRedirectTarget('http://evil.com')).toBeNull();
    expect(validateRedirectTarget('//evil.com')).toBeNull();
  });

  it('returns null for javascript URLs', () => {
    expect(validateRedirectTarget('javascript:alert(1)')).toBeNull();
    expect(validateRedirectTarget('JAVASCRIPT:alert(1)')).toBeNull();
  });

  it('returns null for data URLs', () => {
    expect(validateRedirectTarget('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('returns null for path traversal attempts', () => {
    expect(validateRedirectTarget('/forza/../admin')).toBeNull();
    expect(validateRedirectTarget('/forza//pripady')).toBeNull();
    expect(validateRedirectTarget('/../../admin')).toBeNull();
  });

  it('returns null for external paths', () => {
    expect(validateRedirectTarget('/external/path')).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(validateRedirectTarget(null)).toBeNull();
    expect(validateRedirectTarget(undefined)).toBeNull();
  });
});

describe('getSafeRedirectTarget', () => {
  it('returns the validated path for valid targets', () => {
    expect(getSafeRedirectTarget('/forza/pripady')).toBe('/forza/pripady');
    expect(getSafeRedirectTarget('/browser')).toBe('/browser');
  });

  it('returns null for invalid targets when no fallback provided', () => {
    expect(getSafeRedirectTarget('https://evil.com')).toBeNull();
    expect(getSafeRedirectTarget('javascript:alert(1)')).toBeNull();
  });

  it('returns custom fallback when provided', () => {
    expect(getSafeRedirectTarget('https://evil.com', '/custom')).toBe('/custom');
    expect(getSafeRedirectTarget(null, '/custom')).toBe('/custom');
  });

  it('returns null when no valid target and no fallback', () => {
    // When fallback is undefined and target is invalid, return null
    expect(getSafeRedirectTarget('https://evil.com', undefined)).toBeNull();
  });
});

describe('getLoginRedirectUrl', () => {
  it('returns login URL without next param for null', () => {
    expect(getLoginRedirectUrl(null)).toBe('/auth');
    expect(getLoginRedirectUrl(undefined)).toBe('/auth');
  });

  it('returns login URL with next param for valid internal paths', () => {
    expect(getLoginRedirectUrl('/forza/pripady')).toBe('/auth?next=/forza/pripady');
    expect(getLoginRedirectUrl('/browser')).toBe('/auth?next=/browser');
  });

  it('returns login URL without next param for invalid paths', () => {
    // Invalid paths should not add next parameter
    expect(getLoginRedirectUrl('https://evil.com')).toBe('/auth');
    expect(getLoginRedirectUrl('javascript:alert(1)')).toBe('/auth');
  });

  it('allows custom base URL', () => {
    expect(getLoginRedirectUrl('/forza', '/custom-login')).toBe('/custom-login?next=/forza');
  });

  it('does not add next param for root path', () => {
    // Root path doesn't need to be preserved
    expect(getLoginRedirectUrl('/')).toBe('/auth');
  });
});
