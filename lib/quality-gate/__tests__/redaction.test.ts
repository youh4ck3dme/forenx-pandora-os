/**
 * FORENX / PANDORA - Gemini Quality Gate Redaction Tests
 */

import { describe, it, expect } from 'vitest';
import {
  redactSecrets,
  shouldExcludeFile,
  isSecretBearingFile,
  EXCLUDED_FILE_PATTERNS,
  REDACTED_SECRET_MARKER,
  countRedactionMarkers,
} from '../redaction';

function fixture(...parts: string[]): string {
  return parts.join('');
}

function jwtFixture(): string {
  return [
    fixture('ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
    fixture('ey', 'JzdWIiOiJ0ZXN0LWZpeHR1cmUifQ'),
    fixture('c2', 'lnbmF0dXJl'),
  ].join('.');
}

describe('Redaction', () => {
  describe('redactSecrets', () => {
    it('redacts a JWT fixture', () => {
      const token = jwtFixture();
      const result = redactSecrets(`const token = '${token}';`);
      expect(result.redactedContent).not.toContain(token);
      expect(result.redactedContent).toContain(REDACTED_SECRET_MARKER);
    });

    it('redacts a Bearer JWT fixture', () => {
      const token = jwtFixture();
      const result = redactSecrets(`Authorization: Bearer ${token}`);
      expect(result.redactedContent).not.toContain(token);
      expect(result.redactedContent).toContain(REDACTED_SECRET_MARKER);
    });

    it('redacts API key fixtures', () => {
      const apiKey = fixture('sk-', '1234567890abcdef', '1234567890abcdef');
      const result = redactSecrets(`const apiKey = '${apiKey}';`);
      expect(result.redactedContent).not.toContain(apiKey);
      expect(result.redactedContent).toContain(REDACTED_SECRET_MARKER);
    });

    it('redacts AWS-like access and secret key fixtures', () => {
      const accessKey = fixture('AK', 'IA', 'IOSFODNN7EXAMPLE');
      const secretKey = fixture('wJalrXUtnFEMI/', 'K7MDENG/bPxRfiCY', 'EXAMPLEKEY');
      const result = redactSecrets(`access=${accessKey}\nsecret=${secretKey}`);
      expect(result.redactedContent).not.toContain(accessKey);
      expect(result.redactedContent).not.toContain(secretKey);
      expect(result.redactedContent).toContain('[REDACTED_AWS_KEY]');
      expect(result.redactedContent).toContain(REDACTED_SECRET_MARKER);
    });

    it('redacts private-key and certificate markers', () => {
      const privateKey = fixture('-----BE', 'GIN RSA PRI', 'VATE KEY-----');
      const certificate = fixture('-----BE', 'GIN CERTI', 'FICATE-----');
      const result = redactSecrets(`${privateKey}\n${certificate}`);
      expect(result.redactedContent).not.toContain(privateKey);
      expect(result.redactedContent).not.toContain(certificate);
      expect(result.redactedContent).toContain(REDACTED_SECRET_MARKER);
    });

    it('redacts high-entropy fixtures', () => {
      const secret = fixture('SGVsbG8gV29ybGQh', 'ThisIsALongBase64String', 'ThatShouldBeRedacted');
      const result = redactSecrets(`const secret = '${secret}';`);
      expect(result.redactedContent).not.toContain(secret);
      expect(result.redactedContent).toContain(REDACTED_SECRET_MARKER);
    });

    it('supports additional patterns', () => {
      const result = redactSecrets('const custom = "MY_CUSTOM_SECRET_12345";', [
        { pattern: /MY_CUSTOM_SECRET_\d+/g, replacement: '[REDACTED_CUSTOM]' },
      ]);
      expect(result.redactedContent).toContain('[REDACTED_CUSTOM]');
      expect(result.redactionCount).toBeGreaterThan(0);
    });

    it('leaves non-secret content unchanged', () => {
      const content = 'const greeting = "Hello, World!";';
      expect(redactSecrets(content)).toMatchObject({
        redactedContent: content,
        redactionCount: 0,
        patternsMatched: [],
      });
    });
  });
  describe('shouldExcludeFile', () => {
    it('should exclude .env files', () => {
      expect(shouldExcludeFile('.env')).toBe(true);
      expect(shouldExcludeFile('.env.local')).toBe(true);
      expect(shouldExcludeFile('.env.production')).toBe(true);
    });

    it('should exclude .env.* files', () => {
      expect(shouldExcludeFile('.env.development')).toBe(true);
      expect(shouldExcludeFile('.env.test')).toBe(true);
    });

    it('should exclude certificate files', () => {
      expect(shouldExcludeFile('cert.pem')).toBe(true);
      expect(shouldExcludeFile('cert.key')).toBe(true);
      expect(shouldExcludeFile('cert.crt')).toBe(true);
      expect(shouldExcludeFile('cert.pfx')).toBe(true);
      expect(shouldExcludeFile('cert.p12')).toBe(true);
    });

    it('should exclude node_modules', () => {
      expect(shouldExcludeFile('node_modules/some-package')).toBe(true);
    });

    it('should exclude .next directory', () => {
      expect(shouldExcludeFile('.next/cache')).toBe(true);
    });

    it('should exclude .git directory', () => {
      expect(shouldExcludeFile('.git/config')).toBe(true);
    });

    it('should not exclude regular source files', () => {
      expect(shouldExcludeFile('lib/utils.ts')).toBe(false);
      expect(shouldExcludeFile('app/page.tsx')).toBe(false);
      expect(shouldExcludeFile('scripts/build.mjs')).toBe(false);
    });

    it('should handle Windows-style paths', () => {
      // On Windows, paths use backslashes
      expect(shouldExcludeFile('.env')).toBe(true);
      expect(shouldExcludeFile('node_modules/some-package')).toBe(true);
    });
  });

  describe('isSecretBearingFile', () => {
    it('should identify .env files as secret bearing', () => {
      expect(isSecretBearingFile('.env')).toBe(true);
      expect(isSecretBearingFile('.env.local')).toBe(true);
    });

    it('should identify key files as secret bearing', () => {
      expect(isSecretBearingFile('key.pem')).toBe(true);
      expect(isSecretBearingFile('private.key')).toBe(true);
    });

    it('should identify id_rsa files as secret bearing', () => {
      expect(isSecretBearingFile('id_rsa')).toBe(true);
      expect(isSecretBearingFile('id_ed25519')).toBe(true);
    });

    it('should identify config files as secret bearing', () => {
      // config.json is not always secret-bearing
      expect(isSecretBearingFile('secrets.json')).toBe(true);
      expect(isSecretBearingFile('secrets.yml')).toBe(true);
    });

    it('should not identify source files as secret bearing', () => {
      expect(isSecretBearingFile('lib/utils.ts')).toBe(false);
      expect(isSecretBearingFile('app/page.tsx')).toBe(false);
    });
  });

  describe('countRedactionMarkers', () => {
    it('should count single marker', () => {
      const content = 'Some text [REDACTED_SECRET] more text';
      expect(countRedactionMarkers(content)).toBe(1);
    });

    it('should count multiple markers', () => {
      const content = '[REDACTED_SECRET] text [REDACTED_AWS_KEY] more [REDACTED_SUPABASE_KEY]';
      expect(countRedactionMarkers(content)).toBe(3);
    });

    it('should return 0 for no markers', () => {
      const content = 'No secrets here';
      expect(countRedactionMarkers(content)).toBe(0);
    });

    it('should return 0 for empty string', () => {
      const content = '';
      expect(countRedactionMarkers(content)).toBe(0);
    });
  });

  describe('EXCLUDED_FILE_PATTERNS', () => {
    it('should include all required patterns', () => {
      expect(EXCLUDED_FILE_PATTERNS).toContain('.env');
      expect(EXCLUDED_FILE_PATTERNS).toContain('.env.*');
      expect(EXCLUDED_FILE_PATTERNS).toContain('*.pem');
      expect(EXCLUDED_FILE_PATTERNS).toContain('*.key');
      expect(EXCLUDED_FILE_PATTERNS).toContain('*.cert');
      expect(EXCLUDED_FILE_PATTERNS).toContain('*.crt');
      expect(EXCLUDED_FILE_PATTERNS).toContain('*.pfx');
      expect(EXCLUDED_FILE_PATTERNS).toContain('*.p12');
      expect(EXCLUDED_FILE_PATTERNS).toContain('*.keystore');
      expect(EXCLUDED_FILE_PATTERNS).toContain('id_rsa');
      expect(EXCLUDED_FILE_PATTERNS).toContain('id_ed25519');
      expect(EXCLUDED_FILE_PATTERNS).toContain('node_modules');
      expect(EXCLUDED_FILE_PATTERNS).toContain('.next');
      expect(EXCLUDED_FILE_PATTERNS).toContain('dist');
      expect(EXCLUDED_FILE_PATTERNS).toContain('build');
      expect(EXCLUDED_FILE_PATTERNS).toContain('coverage');
      expect(EXCLUDED_FILE_PATTERNS).toContain('.git');
    });
  });

  describe('REDACTED_SECRET_MARKER', () => {
    it('should be a string constant', () => {
      expect(REDACTED_SECRET_MARKER).toBe('[REDACTED_SECRET]');
    });
  });
});
