#!/usr/bin/env node
/**
 * Deterministický release ZIP zo sledovaných súborov (git archive).
 *
 * - Do archívu idú len súbory sledované gitom v danom commite — lokálne .env,
 *   node_modules, .next, DB súbory ani logy sa tam nedostanú ani omylom.
 * - Navyše explicitný denylist: ak by bol sledovaný env/kľúč/DB súbor,
 *   balenie ZLYHÁ (incident, nie tichá výnimka). Test/cache artefakty sa
 *   vynechajú.
 * - Hodnoty súborov sa nikdy nevypisujú, iba cesty.
 *
 * Použitie: node scripts/release/package.mjs [ref=HEAD] [outDir=dist/release]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ref = process.argv[2] ?? "HEAD";
const outDir = process.argv[3] ?? "dist/release";

/** Sledovaný súbor, ktorý sa tu nájde, je bezpečnostný incident. */
export const FORBIDDEN = [
  /(^|\/)\.env($|\.(?!example$|production\.example$|template$)[^/]+$)/,
  /(^|\/)[^/]*\.(pem|key|p12|pfx|keystore|jks)$/,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/,
  /(^|\/)[^/]*\.(sqlite3?|db|dump)$/,
];

/** .npmrc je povolený (legacy-peer-deps), ale nesmie obsahovať prihlasovacie údaje. */
const NPMRC_CREDENTIAL = /(_authToken|_auth|_password|:username)\s*=/i;

/** Vynechané z artefaktu (nepotrebné v runtime). */
export const EXCLUDED = [
  /^node_modules\//,
  /^vendor\//,
  /^\.git\//,
  /^\.next\//,
  /^dist(-electron)?\//,
  /^(coverage|test-results|playwright-report|scratch)\//,
  /^e2e\//,
  /^supabase\/tests\//,
  /(^|\/)__tests__\//,
  /\.test\.(ts|tsx|js|mjs)$/,
  /\.spec\.(ts|tsx|js|mjs)$/,
  /(^|\/)[^/]*\.log$/,
  /(^|\/)\.cache\//,
  /(^|\/)[^/]*\.tsbuildinfo$/,
];

export function classify(files) {
  const forbidden = files.filter((file) => FORBIDDEN.some((re) => re.test(file)));
  const included = files.filter(
    (file) => !forbidden.includes(file) && !EXCLUDED.some((re) => re.test(file)),
  );
  return { forbidden, included };
}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
}

function main() {
  const commit = git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  const files = git(["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(Boolean);
  const { forbidden, included } = classify(files);
  for (const file of files.filter((f) => /(^|\/)\.npmrc$/.test(f))) {
    if (NPMRC_CREDENTIAL.test(git(["show", `${commit}:${file}`]))) forbidden.push(file);
  }

  if (forbidden.length > 0) {
    console.error("RELEASE BLOCKED: secret/DB-like files are tracked in git:");
    for (const file of forbidden) console.error(`  - ${file}`);
    console.error("Remove them from history and ROTATE the affected credentials.");
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `pandora-${commit.slice(0, 12)}.zip`);
  const listFile = path.join(outDir, `.files-${commit.slice(0, 12)}.txt`);
  fs.writeFileSync(listFile, included.join("\n"));
  try {
    git(["archive", "--format=zip", `--output=${out}`, commit, "--", ...included]);
  } finally {
    fs.rmSync(listFile, { force: true });
  }

  const sha256 = createHash("sha256").update(fs.readFileSync(out)).digest("hex");
  fs.writeFileSync(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`);
  console.log(`release: ${out}`);
  console.log(`files:   ${included.length} (excluded ${files.length - included.length})`);
  console.log(`sha256:  ${sha256}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
    process.argv[1]?.endsWith(path.join("release", "package.mjs"))) {
  main();
}
