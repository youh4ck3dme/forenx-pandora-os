/**
 * FORENX / PANDORA - Gemini Quality Gate Secret Redaction
 * 
 * Detects and redacts likely secrets before sending content to the Gemini API.
 * 
 * SECURITY: This module is SERVER-ONLY. Never import into browser bundles.
 * 
 * WARNING: Redaction via regex is NOT a guarantee. This is a best-effort
 * defense-in-depth measure. The real security boundary is that secrets
 * should NEVER be committed to the repository in the first place.
 */

/**
 * Regex patterns for detecting likely secrets.
 * Ordered from most specific to most general for better matching.
 */
const SECRET_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Bearer tokens (JWT-like)
  {
    pattern: /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi,
    replacement: 'Bearer [REDACTED_SECRET]',
  },
  
  // Generic JWT-like tokens (three base64url parts separated by dots)
  {
    pattern: /[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
    replacement: '[REDACTED_SECRET]',
  },
  
  // AWS Access Key ID (starts with AKIA, ABIA, ACCA, ASIA)
  {
    pattern: /\b(A3T[A-Z0-9]|AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16,}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  
  // AWS Secret Access Key (40 character base64-like string)
  {
    pattern: /\b[A-Za-z0-9\/+=]{40,}\b/g,
    replacement: '[REDACTED_SECRET]',
  },
  
  // Generic API key patterns (common prefixes) - standalone
  {
    pattern: /\b(sk|pk|api[_-]?key|apikey)[A-Za-z0-9\-_]{8,}\b/gi,
    replacement: '[REDACTED_SECRET]',
  },
  
  // Generic API key patterns (common prefixes) - with assignment
  {
    pattern: /\b(sk|pk|api[_-]?key|apikey|secret[_-]?key|access[_-]?key|private[_-]?key|token|secret|password)\s*[=:]\s*["']?([A-Za-z0-9\/+=\-_]{16,})["']?/gi,
    replacement: '$1=[REDACTED_SECRET]',
  },
  
  // Supabase service role key pattern (starts with eyJ)
  {
    pattern: /\b(eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*["']?([A-Za-z0-9\/+=\-_]{16,})["']?/gi,
    replacement: '[REDACTED_SUPABASE_KEY]',
  },
  
  // Generic base64 strings that look like encoded data (common in keys)
  {
    pattern: /\b[A-Za-z0-9\/+=]{64,}\b/g,
    replacement: '[REDACTED_SECRET]',
  },
  
  // Authorization header values
  {
    pattern: /Authorization\s*[=:]\s*["']?Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+["']?/gi,
    replacement: 'Authorization=[REDACTED_SECRET]',
  },
  
  // Generic high-entropy strings (32+ hex characters, common in hashes and some keys)
  {
    pattern: /\b[A-Fa-f0-9]{32,}\b/g,
    replacement: '[REDACTED_SECRET]',
  },
  
  // Private key headers (PEM format)
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    replacement: '-----BEGIN [REDACTED_SECRET]-----',
  },
  
  // Certificate headers
  {
    pattern: /-----BEGIN\s+CERTIFICATE-----/gi,
    replacement: '-----BEGIN [REDACTED_SECRET]-----',
  },
  
  // Generic secret assignments in code
  {
    pattern: /(?:const|let|var|export|process\.env)\s+[A-Z_]+\s*[=:]\s*["']([A-Za-z0-9\/+=\-_]{16,})["']/g,
    replacement: '$1=[REDACTED_SECRET]',
  },
];

/**
 * File patterns that should NEVER be sent to the API regardless of content.
 * These are automatically excluded from the context collection.
 */
export const EXCLUDED_FILE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.cert',
  '*.crt',
  '*.pfx',
  '*.p12',
  '*.keystore',
  'id_rsa',
  'id_ed25519',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.git',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.lock',
  '*.bak*',
  '*.log',
];

/**
 * Redaction result with metadata.
 */
export interface RedactionResult {
  redactedContent: string;
  redactionCount: number;
  patternsMatched: string[];
}

/**
 * Redact secrets from a string.
 * 
 * @param content - The content to redact
 * @param additionalPatterns - Additional patterns to apply (optional)
 * @returns The redacted content with metadata
 */
export function redactSecrets(content: string, additionalPatterns?: Array<{ pattern: RegExp; replacement: string }>): RedactionResult {
  let result = content;
  const patternsMatched: string[] = [];
  let redactionCount = 0;
  
  // Apply built-in patterns
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    const original = result;
    result = result.replace(pattern, replacement);
    if (result !== original) {
      redactionCount++;
      patternsMatched.push(pattern.toString().substring(0, 50));
    }
  }
  
  // Apply additional patterns if provided
  if (additionalPatterns && additionalPatterns.length > 0) {
    for (const { pattern, replacement } of additionalPatterns) {
      const original = result;
      result = result.replace(pattern, replacement);
      if (result !== original) {
        redactionCount++;
        patternsMatched.push(pattern.toString().substring(0, 50));
      }
    }
  }
  
  return {
    redactedContent: result,
    redactionCount,
    patternsMatched,
  };
}

/**
 * Check if a file path should be excluded from context collection.
 * 
 * @param filePath - The file path to check
 * @returns true if the file should be excluded
 */
export function shouldExcludeFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  for (const pattern of EXCLUDED_FILE_PATTERNS) {
    // Handle directory patterns (no wildcard, starts with dot)
    if (pattern.startsWith('.') && !pattern.includes('*')) {
      // Directories like .env, .git, etc.
      if (normalizedPath === pattern || 
          normalizedPath.startsWith(`${pattern}/`) ||
          normalizedPath.includes(`/${pattern}/`)) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // Glob patterns - convert to regex
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
        .replace(/\./g, '\\.');
      const regex = new RegExp(regexPattern, 'i');
      if (regex.test(normalizedPath)) {
        return true;
      }
    } else {
      // Exact match or directory prefix
      if (normalizedPath === pattern || 
          normalizedPath.startsWith(`${pattern}/`) ||
          normalizedPath.includes(`/${pattern}/`)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if a file path is a secret-bearing file.
 * 
 * @param filePath - The file path to check
 * @returns true if the file likely contains secrets
 */
export function isSecretBearingFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  
  const secretFilePatterns = [
    '.env',
    '.env.',
    '*.pem',
    '*.key',
    '*.cert',
    '*.crt',
    '*.pfx',
    '*.p12',
    '*.keystore',
    'id_rsa',
    'id_ed25519',
    'authorized_keys',
    'web.config',
    'app.config',
    'secrets.',
    'config.',
  ];
  
  for (const pattern of secretFilePatterns) {
    if (pattern.startsWith('*')) {
      const extension = pattern.substring(1);
      if (normalizedPath.endsWith(extension)) {
        return true;
      }
    } else if (pattern.includes('.')) {
      // Check if file path contains the pattern
      if (normalizedPath.includes(pattern)) {
        return true;
      }
    } else {
      // Exact match
      if (normalizedPath === pattern) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Create a redacted version marker for tracking.
 */
export const REDACTED_SECRET_MARKER = '[REDACTED_SECRET]';

/**
 * Count the number of redaction markers in a string.
 * 
 * @param content - The content to check
 * @returns The count of redaction markers
 */
export function countRedactionMarkers(content: string): number {
  return (content.match(/\[REDACTED_\w+\]/g) || []).length;
}
