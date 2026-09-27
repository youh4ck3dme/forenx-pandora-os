import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_RULES = {
  NO_ANY: "ZÁKAZ: Použitie kľúčového slova 'any'",
  NO_NON_NULL_ASSERTION: "ZÁKAZ: Použitie non-null assertion operátora '!'",
  NO_DOUBLE_CAST: "ZÁKAZ: Pretypovanie cez 'as unknown as T' alebo 'as any'",
  NO_RAW_JSON_PARSE: "ZÁKAZ: Nekontrolovaný 'JSON.parse' bez Zod validácie",
};

function checkSourceFile(file, program, violations) {
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) return;

  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        file,
        line: line + 1,
        character: character + 1,
        rule: FORBIDDEN_RULES.NO_ANY,
        snippet: node.getText(sourceFile),
      });
    }

    if (node.kind === ts.SyntaxKind.NonNullExpression) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        file,
        line: line + 1,
        character: character + 1,
        rule: FORBIDDEN_RULES.NO_NON_NULL_ASSERTION,
        snippet: node.getText(sourceFile),
      });
    }

    if (ts.isAsExpression(node)) {
      const targetType = node.type.getText(sourceFile);
      if (targetType === "any") {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
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
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
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

    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "JSON.parse" &&
      !file.includes("mistral-client.ts") &&
      !file.includes("ai-service.ts") &&
      !file.includes("forensic-sync.ts")
    ) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
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

export function runAstAudit(targetDir) {
  console.log(`\x1b[35m🔍 [AST GUARD]\x1b[0m Spúšťam statickú analýzu pre: ${targetDir}`);
  const files = [];

  function collectFiles(dir) {
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
    console.log(`\x1b[33m[AST GUARD]\x1b[0m Žiadne TypeScript súbory v: ${targetDir}`);
    return true;
  }

  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
  });

  const violations = [];
  for (const file of files) {
    checkSourceFile(file, program, violations);
  }

  if (violations.length > 0) {
    console.error(`\n\x1b[31m🚨 [AST GUARD ZLYHAL]\x1b[0m Nájdených ${violations.length} závažných architektonických porušení:\n`);
    for (const v of violations) {
      console.error(`  ❌ ${v.file}:${v.line}:${v.character}`);
      console.error(`     Pravidlo: ${v.rule}`);
      console.error(`     Kód:      ${v.snippet}\n`);
    }
    return false;
  }

  console.log(`\x1b[32m✅ [AST GUARD PASS]\x1b[0m Všetkých ${files.length} súborov spĺňa striktné zero-tolerance štandardy.\n`);
  return true;
}

const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(process.cwd(), "lib/ai");

const success = runAstAudit(target);
if (!success) {
  process.exit(1);
}
