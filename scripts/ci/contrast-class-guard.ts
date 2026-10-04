import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

export type ContrastClassViolation = {
  readonly file: string;
  readonly line: number;
  readonly className: string;
};

const WARNING_BACKGROUNDS = /(^|\s)bg-(?:amber|orange|yellow)-\d{2,3}(?:\/\d+)?(?=\s|$)/;
const WHITE_FOREGROUND = /(^|\s)text-white(?:\/\d+)?(?=\s|$)/;

function collectSourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(target));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

export function findWarningContrastViolations(
  rootDirectory: string,
): ContrastClassViolation[] {
  const violations: ContrastClassViolation[] = [];
  for (const file of collectSourceFiles(rootDirectory)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        const className = node.text;
        if (WARNING_BACKGROUNDS.test(className) && WHITE_FOREGROUND.test(className)) {
          violations.push({
            file,
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            className,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}
