/**
 * FORENX / PANDORA - Gemini Quality Gate CLI
 * 
 * Command-line interface for running the independent Gemini code quality gate.
 * 
 * Usage:
 *   npm run quality:gemini
 *   npm run quality:gemini -- --task "P0-09 rate limiter"
 *   npm run quality:gemini -- --write-output
 *   npm run quality:gemini -- --task "Rate limiter audit" --write-output
 * 
 * SECURITY: This module is SERVER-ONLY. Never import into browser bundles.
 * 
 * Exit codes:
 *   0 = SAFE_TO_ACCEPT_LOCALLY
 *   1 = NEEDS_PATCH
 *   2 = REJECT
 *   3 = executor/configuration/API failure
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  runGeminiQualityGateAndExit,
  runGeminiQualityGate,
  QualityGateRunner,
  getExitCodeFromVerdict,
  EXIT_CODES,
  type QualityGateRunResult,
} from '../lib/quality-gate/quality-gate-runner.js';

// Auto-load .env.local if present
try {
  const envPath = join(process.cwd(), '.env.local');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(?:["'](.*)["']|([^#\r\n]*))/);
      if (match) {
        const key = match[1];
        const val = (match[2] !== undefined ? match[2] : match[3] || '').trim();
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Ignore local env load error
}

/**
 * CLI options parsed from command-line arguments.
 */
interface CliOptions {
  task?: string;
  files?: string[];
  writeOutput: boolean;
  outputPath?: string;
  scope?: 'git-diff' | 'working-tree' | 'full';
  help: boolean;
  version: boolean;
}

/**
 * Parse command-line arguments.
 * 
 * @param args - The command-line arguments (excluding node and script name)
 * @returns The parsed CLI options
 */
function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    writeOutput: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;

      case '--version':
      case '-v':
        options.version = true;
        break;

      case '--write-output':
        options.writeOutput = true;
        break;

      case '--task':
        if (i + 1 < args.length) {
          options.task = args[++i];
        } else {
          console.error('Error: --task requires a value');
          process.exit(EXIT_CODES.EXECUTOR_ERROR);
        }
        break;

      case '--output-path':
        if (i + 1 < args.length) {
          options.outputPath = args[++i];
        } else {
          console.error('Error: --output-path requires a value');
          process.exit(EXIT_CODES.EXECUTOR_ERROR);
        }
        break;

      case '--files':
        if (i + 1 < args.length) {
          options.files = args[++i].split(',').map((f) => f.trim());
        } else {
          console.error('Error: --files requires a value');
          process.exit(EXIT_CODES.EXECUTOR_ERROR);
        }
        break;

      case '--scope':
        if (i + 1 < args.length) {
          const val = args[++i];
          if (val === 'git-diff' || val === 'working-tree' || val === 'full') {
            options.scope = val;
          } else {
            console.error(`Error: Invalid scope '${val}'. Must be one of: git-diff, working-tree, full`);
            process.exit(EXIT_CODES.EXECUTOR_ERROR);
          }
        } else {
          console.error('Error: --scope requires a value');
          process.exit(EXIT_CODES.EXECUTOR_ERROR);
        }
        break;

      default:
        // Unknown argument - might be a task description without --task
        if (arg.startsWith('-')) {
          console.error(`Error: Unknown option '${arg}'`);
          printHelp();
          process.exit(EXIT_CODES.EXECUTOR_ERROR);
        } else {
          // Assume it's a task description
          options.task = arg;
        }
        break;
    }
  }

  return options;
}

/**
 * Print help information.
 */
function printHelp(): void {
  console.log(`
FORENX / PANDORA - Gemini Quality Gate CLI

Usage:
  npm run quality:gemini [options]

Options:
  --task <description>    Optional task description for the review
  --files <list>        Comma-separated list of specific files to review
  --write-output        Write the result to .qa/gemini-quality-gate.json
  --output-path <path>  Custom output path (default: .qa/gemini-quality-gate.json)
  --help, -h            Show this help message
  --version, -v         Show version information

Environment Variables:
  GEMINI_API_KEY              Required: Your Google Gemini API key
  GEMINI_QUALITY_MODEL       Model to use (default: gemini-3.7-flash)
  GEMINI_QUALITY_TIMEOUT_MS  Timeout in milliseconds (default: 120000)
  GEMINI_QUALITY_MAX_FILES   Maximum files to process (default: 40)
  GEMINI_QUALITY_MAX_FILE_BYTES Maximum bytes per file (default: 157286)
  GEMINI_QUALITY_MAX_TOTAL_CONTEXT Maximum total context bytes (default: 1048576)

Scopes:
  git-diff          Review only unstaged changes (default git diff)
  working-tree      Review all changes + untracked source files (default)
  full             Review entire repository

Exit Codes:
  0  SAFE_TO_ACCEPT_LOCALLY  Code is safe to accept locally
  1  NEEDS_PATCH             Code needs patches before acceptance
  2  REJECT                 Code should be rejected
  3  EXECUTOR_ERROR          Configuration or API failure

Examples:
  npm run quality:gemini
  npm run quality:gemini -- --task "P0-09 rate limiter"
  npm run quality:gemini -- --task "Rate limiter audit" --write-output
  npm run quality:gemini -- --files "lib/rate-limiter.ts,lib/api/rate-limit/route.ts"

Security Note:
  This tool is REVIEW_ONLY. It will never modify your code, commit changes,
  or push to remote repositories. The API key must be set in the server
  environment and will never be sent to the browser.
`);
}

/**
 * Print version information.
 */
function printVersion(): void {
  console.log(`
FORENX / PANDORA - Gemini Quality Gate
Version: 1.0.0
SDK: @google/genai

This is an independent code quality reviewer for the FORENX / PANDORA OS.
It provides a second opinion on code changes, focusing on security, correctness,
and production readiness.
`);
}

/**
 * Main entry point for the CLI.
 */
async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const options = parseCliArgs(args);

  // Handle help
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Handle version
  if (options.version) {
    printVersion();
    process.exit(0);
  }

  // Check for API key
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 16) {
    console.error('Error: GEMINI_API_KEY is not set or is invalid.');
    console.error('');
    console.error('To use the quality gate, you need a Google Gemini API key.');
    console.error('Set it in your environment:');
    console.error('  export GEMINI_API_KEY="your-api-key-here"');
    console.error('');
    console.error('Or add it to your .env.local file:');
    console.error('  GEMINI_API_KEY=your-api-key-here');
    console.error('');
    console.error('Note: The API key is SERVER-ONLY and will never be exposed to the browser.');
    process.exit(EXIT_CODES.EXECUTOR_ERROR);
  }

  // Run the quality gate
  try {
    const result = await runGeminiQualityGate({
      task: options.task,
      files: options.files,
      writeOutput: options.writeOutput,
      outputPath: options.outputPath,
      scope: options.scope,
    });

    if ('error' in result) {
      console.error(`
╔════════════════════════════════════════════════════════════════════╗`);
      console.error(`║ FORENX QUALITY GATE - EXECUTOR ERROR                                 ║`);
      console.error(`╚════════════════════════════════════════════════════════════════════╝`);
      console.error(`
Error: ${result.error.message}
`);

      if (result.error.details) {
        console.error('Details:', result.error.details);
      }

      console.error(`
Processing Time: ${result.processingTimeMs}ms`);
      process.exit(EXIT_CODES.EXECUTOR_ERROR);
    }

    // Print the result
    console.log(QualityGateRunner.formatResultSummary(result.result));

    // Print findings if there are any
    if (result.result.findings.length > 0) {
      console.log('\nDetailed Findings:');
      for (const finding of result.result.findings) {
        console.log(QualityGateRunner.formatFinding(finding));
      }
    }

    console.log(`\nProcessing Time: ${result.processingTimeMs}ms`);

    // Exit with appropriate code
    process.exit(getExitCodeFromVerdict(result.result.verdict));
  } catch (error: unknown) {
    console.error(`
╔════════════════════════════════════════════════════════════════════╗`);
    console.error(`║ FORENX QUALITY GATE - UNEXPECTED ERROR                               ║`);
    console.error(`╚════════════════════════════════════════════════════════════════════╝`);
    console.error(`
Unexpected Error: ${error instanceof Error ? error.message : String(error)}
`);
    process.exit(EXIT_CODES.EXECUTOR_ERROR);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(EXIT_CODES.EXECUTOR_ERROR);
});
