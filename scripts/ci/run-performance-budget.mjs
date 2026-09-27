#!/usr/bin/env node

/**
 * ⚡ PΛND0RΛ / FORENX - CI PERFORMANCE BUDGET & CLIENT CHUNKS AUDITOR
 *
 * Kontroluje rozpočty výkonu (Performance Budgets):
 * 1. Veľkosť jednotlivých klientskych chunkov v .next/static/chunks/
 *    - Limit: Max 250 KB (gzipped) / 800 KB (raw) na chunk.
 *    - Výnimky: Špeciálne lazy-loaded binary/worker moduly (napr. HEIC konvertor).
 * 2. First-load JS na hlavnej trase '/'
 *    - Limit: Max 350 KB (gzipped).
 * 3. Integrácia auditu Leva debug GUI (scripts/check-leva.mjs --strict).
 *
 * Použitie:
 *   node scripts/ci/run-performance-budget.mjs
 *   node scripts/ci/run-performance-budget.mjs --strict
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

const isStrict = process.argv.includes('--strict');

const MAX_CHUNK_GZIP_KB = 250;
const MAX_CHUNK_RAW_KB = 800;
const MAX_FIRST_LOAD_GZIP_KB = 350;

// Zoznam povolených ťažkých dynamických vendor modulov (napr. WebAssembly / HEIC decoder)
const EXEMPTED_VENDOR_PATTERNS = [
  /heic/i,
  /monaco/i,
  /pdf/i,
];

console.log('\n=======================================================');
console.log('  ⚡ PΛND0RΛ / FORENX - CI PERFORMANCE BUDGET GUARD');
console.log('=======================================================\n');

// 1. Spustenie kontroly Leva debug panelu
console.log('🔍 Krok 1: Kontrola úniku Leva GUI do produkcie...');
try {
  execSync('node scripts/check-leva.mjs --strict', { stdio: 'inherit' });
  console.log('✅ Leva guard: Všetky inšpekcie prešli.\n');
} catch (err) {
  console.error('\n❌ Zlyhanie Leva guardu: Debug panel Leva nie je ošetrený v produkčnom kóde.');
  if (isStrict) {
    process.exit(1);
  }
}

// 2. Kontrola existencie .next
const nextDir = path.resolve(process.cwd(), '.next');
if (!fs.existsSync(nextDir)) {
  console.error('❌ Priečinok .next neexistuje. Najprv spustite "npm run build".');
  process.exit(1);
}

// 3. Rekurzívne nájdenie všetkých JS chunkov
function getAllJsFiles(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const chunksDir = path.join(nextDir, 'static', 'chunks');
const allChunks = getAllJsFiles(chunksDir);

const chunkStats = allChunks.map((filePath) => {
  const buf = fs.readFileSync(filePath);
  const rawKb = +(buf.length / 1024).toFixed(1);
  const gzKb = +(zlib.gzipSync(buf).length / 1024).toFixed(1);
  const fileName = path.basename(filePath);
  const isExempted = EXEMPTED_VENDOR_PATTERNS.some((pattern) => pattern.test(fileName) || pattern.test(buf.slice(0, 1000).toString()));

  const exceedsRaw = rawKb > MAX_CHUNK_RAW_KB;
  const exceedsGz = gzKb > MAX_CHUNK_GZIP_KB;
  const failed = !isExempted && (exceedsRaw || exceedsGz);

  return {
    filePath,
    fileName,
    rawKb,
    gzKb,
    isExempted,
    failed,
    exceedsRaw,
    exceedsGz,
  };
}).sort((a, b) => b.gzKb - a.gzKb);

console.log(`📦 Analyzovaných klientskych chunkov: ${chunkStats.length}`);
console.log('\nTop 10 najväčších chunkov:');
console.log('----------------------------------------------------------------------');
console.log(' Stav      | Názov chunk súboru                    | Raw (KB) | Gzip (KB)');
console.log('----------------------------------------------------------------------');

let chunkViolations = 0;

for (const chunk of chunkStats.slice(0, 10)) {
  let status = '✅ PASS  ';
  if (chunk.failed) {
    status = '❌ FAIL  ';
    chunkViolations++;
  } else if (chunk.isExempted && (chunk.exceedsRaw || chunk.exceedsGz)) {
    status = 'ℹ️  EXEMPT';
  }

  const namePad = chunk.fileName.length > 36 ? chunk.fileName.slice(0, 33) + '...' : chunk.fileName.padEnd(36);
  console.log(` ${status} | ${namePad} | ${String(chunk.rawKb).padStart(8)} | ${String(chunk.gzKb).padStart(9)}`);
}
console.log('----------------------------------------------------------------------\n');

// 4. Kontrola First-load JS pre trasu '/'
console.log('🚀 Krok 2: Výpočet First-load JS pre hlavnú trasu "/"...');
let firstLoadGzKb = 0;
let firstLoadRawKb = 0;

const appManifestPath = path.join(nextDir, 'app-build-manifest.json');
if (fs.existsSync(appManifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(appManifestPath, 'utf8'));
  const pageChunks = manifest.pages['/page'] || [];
  const layoutChunks = manifest.pages['/layout'] || [];
  const rootFiles = Array.from(new Set([...layoutChunks, ...pageChunks])).filter((f) => f.endsWith('.js'));

  for (const relPath of rootFiles) {
    const fullPath = path.join(nextDir, relPath);
    if (fs.existsSync(fullPath)) {
      const buf = fs.readFileSync(fullPath);
      firstLoadRawKb += +(buf.length / 1024);
      firstLoadGzKb += +(zlib.gzipSync(buf).length / 1024);
    }
  }

  firstLoadRawKb = +firstLoadRawKb.toFixed(1);
  firstLoadGzKb = +firstLoadGzKb.toFixed(1);

  const passedFirstLoad = firstLoadGzKb <= MAX_FIRST_LOAD_GZIP_KB;
  const statusIcon = passedFirstLoad ? '✅ PASS' : '❌ FAIL';

  console.log(` First-load JS (root /): ${firstLoadGzKb} KB (gzipped) / ${firstLoadRawKb} KB (raw)`);
  console.log(` Rozpočet: max ${MAX_FIRST_LOAD_GZIP_KB} KB gzipped -> [${statusIcon}]`);

  if (!passedFirstLoad) {
    chunkViolations++;
  }
} else {
  console.log('ℹ️  app-build-manifest.json nenájdený, preskakujem výpočet first-load route.');
}

console.log('\n-------------------------------------------------------');
if (chunkViolations === 0) {
  console.log('🎉 VŠETKY PERFORMANCE ROZPOČTY A CI LIMITY SPLNENÉ!\n');
  process.exit(0);
} else {
  console.error(`❌ Zistených ${chunkViolations} porušení rozpočtu výkonu.`);
  if (isStrict) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
