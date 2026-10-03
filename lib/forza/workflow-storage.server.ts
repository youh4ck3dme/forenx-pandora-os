import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Zabezpečí, že adresár pre trvalé workflow dáta (.workflow-data/runs) existuje
 * a má práva na zápis.
 * 
 * V produkčnom Docker kontajneri (kde /app beží pod unprivileged používateľom nextjs)
 * zabráni ENOENT / EACCES chybám automatickým overením zápisu a prípadným fallbackom
 * na os.tmpdir()/pandora-workflow-data.
 */
export async function ensureWorkflowStorageDir(): Promise<string> {
  const candidates = [
    process.env.WORKFLOW_LOCAL_DATA_DIR,
    path.join(process.cwd(), ".workflow-data"),
    path.join(os.tmpdir(), "pandora-workflow-data"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    try {
      const runsDir = path.join(dir, "runs");
      await fs.promises.mkdir(runsDir, { recursive: true });
      const testFile = path.join(
        runsDir,
        `.write-probe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      );
      await fs.promises.writeFile(testFile, "ok", "utf8");
      await fs.promises.unlink(testFile);
      process.env.WORKFLOW_LOCAL_DATA_DIR = dir;
      return dir;
    } catch {
      // Skúšame ďalšieho kandidáta
    }
  }

  const fallback = path.join(os.tmpdir(), "pandora-workflow-data");
  await fs.promises.mkdir(path.join(fallback, "runs"), { recursive: true });
  process.env.WORKFLOW_LOCAL_DATA_DIR = fallback;
  return fallback;
}
