/**
 * FORENX / PANDORA - Gemini Quality Gate Repository Context Collector
 * 
 * Collects LOCAL CLI context from the repository for review.
 * Executes SAFE read-only Git commands only.
 * 
 * SECURITY: This module is SERVER-ONLY. Never import into browser bundles.
 * 
 * WARNING: Do NOT let AI provide arbitrary shell commands.
 * Do NOT execute model-generated shell commands.
 * Do NOT expose an unrestricted exec API.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  EXCLUDED_FILE_PATTERNS,
  shouldExcludeFile,
  isSecretBearingFile,
} from './redaction';

/**
 * Repository context for code review.
 */
export interface RepositoryContext {
  // Current branch
  branch: string;
  
  // Current HEAD commit SHA
  commitSha: string;
  
  // Git status (short format)
  status: string;
  
  // List of changed files (modified, staged)
  changedFiles: string[];
  
  // List of untracked files
  untrackedFiles: string[];
  
  // Map of changed file paths to their content
  fileContents: Map<string, string>;
  
  // Git diff output (unstaged)
  gitDiff: string;
  
  // Git diff output (staged)
  gitDiffCached: string;
  
  // Total bytes of context collected
  totalBytes: number;
  
  // Whether context was truncated
  contextTruncated: boolean;
  
  // Number of files excluded
  filesExcluded: number;
  
  // Number of secrets redacted
  secretsRedacted: number;
  
  // Scope used for collection
  scope: string;
}

/**
 * Configuration for context collection.
 */
export interface ContextCollectionConfig {
  // Maximum number of files to include
  maxFiles: number;
  
  // Maximum bytes per file
  maxFileBytes: number;
  
  // Maximum total context bytes
  maxTotalContext: number;
  
  // Repository root path (defaults to current working directory)
  repoPath?: string;
  
  // Scope of collection
  scope?: 'git-diff' | 'working-tree' | 'full';
  
  // Include untracked files (default: false for git-diff, true for working-tree)
  includeUntracked?: boolean;
  
  // Include staged changes
  includeStaged?: boolean;
}

/**
 * Default context collection configuration.
 */
export const DEFAULT_CONTEXT_CONFIG: ContextCollectionConfig = {
  maxFiles: 40,
  maxFileBytes: 157286, // 150 KB
  maxTotalContext: 1048576, // 1 MB
  scope: 'working-tree',
  includeUntracked: true,
  includeStaged: true,
};

/**
 * Allowed Git commands (read-only only).
 */
const ALLOWED_GIT_COMMANDS = [
  'git branch --show-current',
  'git rev-parse HEAD',
  'git status --short',
  'git diff --stat',
  'git diff --name-status',
  'git diff --no-ext-diff',
  'git diff --cached',
  'git ls-files --others --exclude-standard',
] as const;

/**
 * Execute a safe Git command and return the output.
 * 
 * @param command - The command to execute
 * @param repoPath - The repository path
 * @returns The command output or null if failed
 * @throws Error if command is not allowed
 */
function executeGitCommand(command: string, repoPath: string): string | null {
  // Verify command is in the allowed list
  const isAllowed = ALLOWED_GIT_COMMANDS.some((allowed) => 
    command.trim() === allowed || command.trim().startsWith(allowed)
  );
  
  if (!isAllowed) {
    throw new Error(`Git command not allowed: ${command}`);
  }
  
  try {
    const output = execSync(command, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * Get the current branch name.
 * 
 * @param repoPath - The repository path
 * @returns The branch name or 'unknown'
 */
function getCurrentBranch(repoPath: string): string {
  const output = executeGitCommand('git branch --show-current', repoPath);
  return output || 'unknown';
}

/**
 * Get the current HEAD commit SHA.
 * 
 * @param repoPath - The repository path
 * @returns The commit SHA or 'unknown'
 */
function getCurrentCommitSha(repoPath: string): string {
  const output = executeGitCommand('git rev-parse HEAD', repoPath);
  return output || 'unknown';
}

/**
 * Get the Git status (short format).
 * 
 * @param repoPath - The repository path
 * @returns The status output or empty string
 */
function getGitStatus(repoPath: string): string {
  const output = executeGitCommand('git status --short', repoPath);
  return output || '';
}

/**
 * Get the list of changed files.
 * 
 * @param repoPath - The repository path
 * @returns Array of changed file paths
 */
function getChangedFiles(repoPath: string): string[] {
  const output = executeGitCommand('git diff --name-status -- . ":(exclude)package-lock.json" ":(exclude)yarn.lock" ":(exclude)pnpm-lock.yaml"', repoPath);
  if (!output) {
    return [];
  }
  
  const lines = output.split('\n');
  const files: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      // git diff --name-status outputs: <status>\t<file>
      const parts = trimmed.split('\t');
      if (parts.length >= 2) {
        files.push(parts.slice(1).join('\t'));
      } else {
        // Fallback: treat the whole line as file path
        files.push(trimmed);
      }
    }
  }
  
  return files;
}

/**
 * Get the full Git diff.
 * 
 * @param repoPath - The repository path
 * @returns The diff output or empty string
 */
function getGitDiff(repoPath: string): string {
  const output = executeGitCommand('git diff --no-ext-diff -- . ":(exclude)package-lock.json" ":(exclude)yarn.lock" ":(exclude)pnpm-lock.yaml"', repoPath);
  return output || '';
}

/**
 * Get staged changes.
 * 
 * @param repoPath - The repository path
 * @returns The cached diff output or empty string
 */
function getGitDiffCached(repoPath: string): string {
  const output = executeGitCommand('git diff --cached -- . ":(exclude)package-lock.json" ":(exclude)yarn.lock" ":(exclude)pnpm-lock.yaml"', repoPath);
  return output || '';
}

/**
 * Get untracked file paths.
 * 
 * @param repoPath - The repository path
 * @returns Array of untracked file paths
 */
function getUntrackedFiles(repoPath: string): string[] {
  const output = executeGitCommand('git ls-files --others --exclude-standard', repoPath);
  if (!output) {
    return [];
  }
  return output.split('\n').map(f => f.trim()).filter(f => f.length > 0);
}

/**
 * Read file content safely with size limits.
 * 
 * @param filePath - The file path
 * @param maxBytes - Maximum bytes to read
 * @returns The file content or null if cannot be read
 */
function readFileSafely(filePath: string, maxBytes: number): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    
    const stats = statSync(filePath);
    if (stats.size > maxBytes) {
      // Read only the first maxBytes
      const buffer = Buffer.alloc(maxBytes);
      const fd = openSync(filePath, 'r');
      try {
        readSync(fd, buffer, 0, maxBytes, 0);
        return buffer.toString('utf-8');
      } finally {
        closeSync(fd);
      }
    }
    
    return readFileSync(filePath, { encoding: 'utf-8', flag: 'r' });
  } catch {
    return null;
  }
}

// Node.js sync file descriptors (for readFileSafely)
import { openSync, readSync, closeSync } from 'node:fs';

/**
 * Check if a file is a relevant source file (not binary, not env, etc.)
 * 
 * @param filePath - The file path (relative or absolute)
 * @returns true if the file is a relevant source file
 */
function isRelevantSourceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  
  // Exclude directory paths
  if (normalized.endsWith('/')) {
    return false;
  }
  
  // Check excluded patterns
  if (shouldExcludeFile(normalized)) {
    return false;
  }
  
  // Check if it's a secret-bearing file
  if (isSecretBearingFile(normalized)) {
    return false;
  }
  
  // Check for source file extensions
  const sourceExtensions = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.json', '.yaml', '.yml', '.toml',
    '.sql', '.prisma', '.graphql', '.gql',
    '.css', '.scss', '.sass', '.less',
    '.html', '.htm', '.xml',
  ];
  
  for (const ext of sourceExtensions) {
    if (normalized.endsWith(ext)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a file should be included in the context.
 * 
 * @param filePath - The file path
 * @param relativePath - The relative path from repo root
 * @returns true if the file should be included
 */
function shouldIncludeFile(filePath: string, relativePath: string): boolean {
  // Exclude directories
  try {
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  
  // Check excluded patterns
  if (shouldExcludeFile(relativePath) || shouldExcludeFile(filePath)) {
    return false;
  }
  
  // Check if it's a binary file (basic heuristic)
  if (relativePath.endsWith('.bin') || 
      relativePath.endsWith('.png') || 
      relativePath.endsWith('.jpg') || 
      relativePath.endsWith('.jpeg') ||
      relativePath.endsWith('.gif') ||
      relativePath.endsWith('.ico') ||
      relativePath.endsWith('.woff') ||
      relativePath.endsWith('.woff2') ||
      relativePath.endsWith('.ttf') ||
      relativePath.endsWith('.eot') ||
      relativePath.endsWith('.pdf') ||
      relativePath.endsWith('.docx') ||
      relativePath.endsWith('.xlsx') ||
      relativePath.endsWith('.zip') ||
      relativePath.endsWith('.gz') ||
      relativePath.endsWith('.tar') ||
      relativePath.endsWith('.dll') ||
      relativePath.endsWith('.exe') ||
      relativePath.endsWith('.so') ||
      relativePath.endsWith('.dylib')) {
    return false;
  }
  
  return true;
}

/**
 * Collect repository context for code review.
 * 
 * @param config - The collection configuration
 * @returns The repository context
 */
export function collectRepositoryContext(
  config: ContextCollectionConfig = DEFAULT_CONTEXT_CONFIG
): RepositoryContext {
  const repoPath = resolve(config.repoPath || process.cwd());
  const fileContents = new Map<string, string>();
  let totalBytes = 0;
  let contextTruncated = false;
  let filesExcluded = 0;
  let secretsRedacted = 0;
  
  // Collect Git information
  const branch = getCurrentBranch(repoPath);
  const commitSha = getCurrentCommitSha(repoPath);
  const status = getGitStatus(repoPath);
  const changedFiles = getChangedFiles(repoPath);
  const gitDiff = getGitDiff(repoPath);
  
  // Determine which files to process based on scope
  let filesToProcess: string[];
  const effectiveScope = config.scope || 'working-tree';
  const includeUntracked = config.includeUntracked !== false;
  const includeStaged = config.includeStaged !== false;
  
  switch (effectiveScope) {
    case 'git-diff':
      // Only files with unstaged changes (git diff)
      filesToProcess = changedFiles.filter(f => !f.startsWith(':') && f.length > 0);
      break;
      
    case 'working-tree':
    default:
      // All changed files + untracked relevant source files
      const stagedDiff = includeStaged ? getGitDiffCached(repoPath) : '';
      const untrackedFiles = includeUntracked ? getUntrackedFiles(repoPath) : [];
      
      // Get all modified and staged files
      const modifiedFiles = changedFiles.filter(f => !f.startsWith(':') && f.length > 0);
      
      // Combine: modified + staged + untracked
      // Deduplicate and filter
      const allFiles = new Set([...modifiedFiles]);
      
      // Add untracked files that are relevant source files
      for (const untracked of untrackedFiles) {
        const fullPath = join(repoPath, untracked);
        if (isRelevantSourceFile(untracked)) {
          allFiles.add(untracked);
        }
      }
      
      filesToProcess = Array.from(allFiles);
      break;
      
    case 'full':
      // All relevant files in the repository
      filesToProcess = getAllRelevantFiles(repoPath);
      break;
  }
  
  // Process files
  for (const relativePath of filesToProcess) {
    // Check if we've reached the file limit
    if (fileContents.size >= config.maxFiles) {
      contextTruncated = true;
      break;
    }
    
    const fullPath = join(repoPath, relativePath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    // Check if file should be included
    if (!shouldIncludeFile(fullPath, normalizedPath)) {
      filesExcluded++;
      continue;
    }
    
    // Check if file is a secret-bearing file
    if (isSecretBearingFile(normalizedPath)) {
      filesExcluded++;
      continue;
    }
    
    // Read file content
    const content = readFileSafely(fullPath, config.maxFileBytes);
    if (content === null) {
      filesExcluded++;
      continue;
    }
    
    // Check if adding this file would exceed total context limit
    const contentBytes = Buffer.byteLength(content, 'utf-8');
    if (totalBytes + contentBytes > config.maxTotalContext) {
      // Calculate how much we can include
      const remainingBytes = config.maxTotalContext - totalBytes;
      if (remainingBytes > 0) {
        const truncatedContent = Buffer.from(content, 'utf-8').slice(0, remainingBytes).toString('utf-8');
        fileContents.set(normalizedPath, truncatedContent);
        totalBytes = config.maxTotalContext;
        contextTruncated = true;
        break;
      } else {
        contextTruncated = true;
        break;
      }
    }
    
    // Add file content
    fileContents.set(normalizedPath, content);
    totalBytes += contentBytes;
  }
  
  // Count secrets in the collected content
  fileContents.forEach(content => {
    secretsRedacted += (content.match(/\[REDACTED_\w+\]/g) || []).length;
  });
  
  // Get staged diff if needed
  const gitDiffCached = includeStaged ? getGitDiffCached(repoPath) : '';
  
  // Get untracked files if needed
  const untrackedFiles = includeUntracked ? getUntrackedFiles(repoPath) : [];
  
  return {
    branch,
    commitSha,
    status,
    changedFiles,
    untrackedFiles,
    fileContents,
    gitDiff,
    gitDiffCached,
    totalBytes,
    contextTruncated,
    filesExcluded,
    secretsRedacted,
    scope: effectiveScope,
  };
}

/**
 * Get all relevant files from the repository.
 * Used when there are no git changes (e.g., reviewing uncommitted work).
 * 
 * @param repoPath - The repository path
 * @returns Array of relevant file paths
 */
function getAllRelevantFiles(repoPath: string): string[] {
  const files: string[] = [];
  
  try {
    // Walk through lib/ directory for TypeScript files
    const libPath = join(repoPath, 'lib');
    if (existsSync(libPath)) {
      walkDirectory(libPath, repoPath, files, ['.ts', '.tsx', '.js', '.jsx']);
    }
    
    // Also include app/ directory
    const appPath = join(repoPath, 'app');
    if (existsSync(appPath)) {
      walkDirectory(appPath, repoPath, files, ['.ts', '.tsx', '.js', '.jsx']);
    }
    
    // Include scripts/ directory
    const scriptsPath = join(repoPath, 'scripts');
    if (existsSync(scriptsPath)) {
      walkDirectory(scriptsPath, repoPath, files, ['.ts', '.mjs', '.js']);
    }
    
    // Include components/ directory
    const componentsPath = join(repoPath, 'components');
    if (existsSync(componentsPath)) {
      walkDirectory(componentsPath, repoPath, files, ['.ts', '.tsx', '.js', '.jsx']);
    }
  } catch {
    // If directory walking fails, return empty array
  }
  
  return files.slice(0, 100); // Limit to 100 files max
}

/**
 * Recursively walk a directory and collect files with specific extensions.
 * 
 * @param dirPath - The directory path
 * @param repoPath - The repository root path
 * @param files - Array to accumulate file paths
 * @param extensions - File extensions to include
 */
function walkDirectory(
  dirPath: string,
  repoPath: string,
  files: string[],
  extensions: string[]
): void {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = fullPath.substring(repoPath.length + 1).replace(/\\/g, '/');
      
      if (entry.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (!['node_modules', '.git', '.next', 'dist', 'build', 'coverage'].includes(entry.name)) {
          walkDirectory(fullPath, repoPath, files, extensions);
        }
      } else if (entry.isFile()) {
        // Check extension
        for (const ext of extensions) {
          if (entry.name.endsWith(ext)) {
            // Skip excluded files
            if (!shouldExcludeFile(relativePath)) {
              files.push(relativePath);
            }
            break;
          }
        }
      }
    }
  } catch {
    // Ignore errors reading directories
  }
}

// Import readdirSync for directory walking
import { readdirSync } from 'node:fs';

/**
 * Build a context string from repository context.
 * 
 * @param context - The repository context
 * @returns A formatted context string
 */
export function buildContextString(context: RepositoryContext): string {
  const parts: string[] = [];
  
  // Add Git metadata
  parts.push(`Branch: ${context.branch}`);
  parts.push(`Commit: ${context.commitSha}`);
  parts.push(`Status: ${context.status}`);
  parts.push(`Scope: ${context.scope}`);
  parts.push('');
  
  // Add git diff if available
  if (context.gitDiff) {
    parts.push('Unstaged Changes:');
    parts.push('─'.repeat(60));
    parts.push(context.gitDiff);
    parts.push('');
  }
  
  // Add staged diff if available
  if (context.gitDiffCached) {
    parts.push('Staged Changes:');
    parts.push('─'.repeat(60));
    parts.push(context.gitDiffCached);
    parts.push('');
  }
  
  // Add changed files list
  if (context.changedFiles.length > 0) {
    parts.push('Changed Files:');
    parts.push('─'.repeat(60));
    for (const file of context.changedFiles) {
      parts.push(`  - ${file}`);
    }
    parts.push('');
  }
  
  // Add untracked files list
  if (context.untrackedFiles.length > 0) {
    parts.push('Untracked Files:');
    parts.push('─'.repeat(60));
    for (const file of context.untrackedFiles) {
      parts.push(`  - ${file} (untracked)`);
    }
    parts.push('');
  }
  
  // Add file contents
  if (context.fileContents.size > 0) {
    parts.push('File Contents:');
    parts.push('═'.repeat(60));
    
    context.fileContents.forEach((content, filePath) => {
      parts.push('');
      parts.push(`// File: ${filePath}`);
      parts.push('// ' + '─'.repeat(57));
      parts.push(content);
      parts.push('');
      parts.push('─'.repeat(60));
    });
  }
  
  // Add truncation notice if applicable
  if (context.contextTruncated) {
    parts.push('');
    parts.push('⚠️  Context truncated due to size limits.');
  }
  
  // Add exclusion notice if applicable
  if (context.filesExcluded > 0) {
    parts.push('');
    parts.push(`ℹ️  ${context.filesExcluded} files excluded (binary, env, or other).`);
  }
  
  return parts.join('\n');
}

/**
 * Collect context and build the final prompt-ready string.
 * 
 * @param config - The collection configuration
 * @returns The formatted context string
 */
export function collectAndBuildContext(config: ContextCollectionConfig = DEFAULT_CONTEXT_CONFIG): string {
  const context = collectRepositoryContext(config);
  return buildContextString(context);
}
