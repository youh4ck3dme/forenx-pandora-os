import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly character: number;
  readonly rule: string;
  readonly snippet: string;
}

const FORBIDDEN_RULES = {
  NO_ANY: "ZÁKAZ: Použitie kľúčového slova 'any'",
  NO_NON_NULL_ASSERTION: "ZÁKAZ: Použitie non-null assertion operátora '!'",
  NO_DOUBLE_CAST: "ZÁKAZ: Pretypovanie cez 'as unknown as T' alebo 'as any'",
  NO_RAW_JSON_PARSE: "ZÁKAZ: Nekontrolovaný 'JSON.parse' bez Zod validácie",
} as const;

function checkSourceFile(file: string, program: ts.Program, violations: Violation[]): void {
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) return;

  function visit(node: ts.Node): void {
    // 1. Detekcia 'any'
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line, character } = sourceFile!.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        file,
        line: line + 1,
        character: character + 1,
        rule: FORBIDDEN_RULES.NO_ANY,
        snippet: node.getText(sourceFile),
      });
    }

    // 2. Detekcia non-null assertion (!)
    if (node.kind === ts.SyntaxKind.NonNullExpression) {
      const { line, character } = sourceFile!.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        file,
        line: line + 1,
        character: character + 1,
        rule: FORBIDDEN_RULES.NO_NON_NULL_ASSERTION,
        snippet: node.getText(sourceFile),
      });
    }

    // 3. Detekcia 'as unknown as T' alebo 'as any'
    if (ts.isAsExpression(node)) {
      const targetType = node.type.getText(sourceFile);
      if (targetType === "any") {
        const { line, character } = sourceFile!.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          file,
          line: line + 1,
          character: character + 1,
          rule: FORBIDDEN_RULES.NO_ANY,
          snippet: node.getText(sourceFile),
        });
      }

      if (ts.isAsExpression(node.expression)) {
        const innerType = node.expression.type.getText(sourceFile);
        if (innerType === "unknown" || innerType === "any") {
          const { line, character } = sourceFile!.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push({
            file,
            line: line + 1,
            character: character + 1,
            rule: FORBIDDEN_RULES.NO_DOUBLE_CAST,
            snippet: node.getText(sourceFile),
          });
        }
      }
    }

    // 4. Detekcia nekontrolovaného JSON.parse
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "JSON.parse" &&
      !file.includes("mistral-client.ts") &&
      !file.includes("ai-service.ts") &&
      !file.includes("forensic-sync.ts")
    ) {
      const { line, character } = sourceFile!.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        file,
        line: line + 1,
        character: character + 1,
        rule: FORBIDDEN_RULES.NO_RAW_JSON_PARSE,
        snippet: node.getText(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

export function runAstAudit(targetDir: string): boolean {
  console.log(`🔍 [AST GUARD] Spúšťam statickú analýzu pre: ${targetDir}`);
  const files: string[] = [];

  function collectFiles(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        entry.name !== "node_modules" &&
        entry.name !== ".next" &&
        entry.name !== "dist" &&
        entry.name !== "scratch"
      ) {
        collectFiles(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(fullPath);
      }
    }
  }

  collectFiles(targetDir);

  if (files.length === 0) {
    console.log(`[AST GUARD] Žiadne TypeScript súbory v zložke: ${targetDir}`);
    return true;
  }

  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
  });

  const violations: Violation[] = [];
  for (const file of files) {
    checkSourceFile(file, program, violations);
  }

  if (violations.length > 0) {
    console.error(`\n🚨 [AST GUARD ZLYHAL] Nájdených ${violations.length} závažných architektonických porušení:\n`);
    for (const v of violations) {
      console.error(`  ❌ ${v.file}:${v.line}:${v.character}`);
      console.error(`     Pravidlo: ${v.rule}`);
      console.error(`     Kód:      ${v.snippet}\n`);
    }
    return false;
  }

  console.log(`✅ [AST GUARD PASS] Všetkých ${files.length} súborov spĺňa striktné zero-tolerance štandardy.\n`);
  return true;
}

// Spustenie pri priamom volaní
const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(process.cwd(), "lib/ai");

const isMain = process.argv[1]?.includes("ast-guard");
if (isMain) {
  const success = runAstAudit(target);
  if (!success) {
    process.exit(1);
  }
}
