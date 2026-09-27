#!/usr/bin/env node

/**
 * 🔍 PΛND0RΛ / FORENX - LEVA DEBUG GUI AUDIT & PRODUCTION GUARD
 *
 * Účel skriptu:
 * 1. Detegovať výskyt 'leva' (debug controls pre Three.js/WebGL) v celej klientskej aplikácii.
 * 2. Overiť, či je <Leva ... /> v produkčnom režime skrytá alebo podmienená:
 *    - hidden={process.env.NODE_ENV === "production"}
 *    - alebo podmienená cez withLeva / process.env.NEXT_PUBLIC_ENABLE_LEVA / isDev
 * 3. Zaručiť, že debug GUI neuniká na produkciu (Vercel / VPS / Mobile / Electron)
 *    a nezvyšuje TBT (Total Blocking Time) a bundle size.
 *
 * Použitie:
 *   node scripts/check-leva.mjs
 *   node scripts/check-leva.mjs --strict
 *   node scripts/check-leva.mjs --fix
 */

import fs from 'node:fs';
import path from 'node:path';

const isStrict = process.argv.includes('--strict');
const shouldFix = process.argv.includes('--fix');

console.log('\n=======================================================');
console.log('  🎛️  PΛND0RΛ / FORENX - LEVA PRODUCTION GUARD');
console.log('=======================================================\n');

const ROOT_DIR = process.cwd();
const TARGET_DIRS = ['components', 'app', 'routes', 'lib'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

/**
 * Rekurzívne nájde všetky zdrojové súbory
 */
function getSourceFiles(dirPath, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next' && entry.name !== 'dist' && entry.name !== 'dist-electron') {
        getSourceFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

let totalFilesChecked = 0;
const findings = [];

for (const targetDir of TARGET_DIRS) {
  const dirPath = path.join(ROOT_DIR, targetDir);
  const files = getSourceFiles(dirPath);

  for (const file of files) {
    totalFilesChecked++;
    const content = fs.readFileSync(file, 'utf8');

    // Hľadáme import z "leva"
    const hasLevaImport = /import\s+.*?\s+from\s+['"]leva['"]/.test(content);
    const hasLevaComponent = /<Leva\b/.test(content);

    if (hasLevaImport || hasLevaComponent) {
      const relPath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
      const lines = content.split(/\r?\n/);
      
      let isGuarded = false;
      let lineNum = 0;
      let matchedLine = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('<Leva') || line.includes('from "leva"') || line.includes("from 'leva'")) {
          lineNum = i + 1;
          matchedLine = line.trim();
        }
        if (
          line.includes('process.env.NODE_ENV === "production"') ||
          line.includes("process.env.NODE_ENV === 'production'") ||
          line.includes('hidden={') ||
          line.includes('isDev') ||
          line.includes('withLeva')
        ) {
          isGuarded = true;
        }
      }

      // Špeciálna kontrola: v GL komponente musí byť <Leva hidden={...} />
      const isGlComponent = relPath === 'components/gl/index.tsx';
      const hasStrictHiddenProp = /<Leva\s+[^>]*hidden\s*=/.test(content);

      findings.push({
        file: relPath,
        lineNum,
        matchedLine,
        hasLevaImport,
        hasLevaComponent,
        isGuarded: isGlComponent ? hasStrictHiddenProp : isGuarded,
        isGlComponent
      });
    }
  }
}

console.log(`📁 Skontrolovaných zdrojových súborov: ${totalFilesChecked}`);
console.log(`🔎 Nájdených referencií na Leva: ${findings.length}\n`);

let unshieldedCount = 0;

for (const item of findings) {
  const status = item.isGuarded ? '✅ CHRÁNENÁ (GATED)' : '⚠️  NECHRÁNENÁ (EXPOSED)';
  if (!item.isGuarded) unshieldedCount++;

  console.log(` ${status.padEnd(25)} | ${item.file}:${item.lineNum}`);
  if (item.matchedLine) {
    console.log(`   ↳ riadok: ${item.matchedLine}`);
  }
}

console.log('\n-------------------------------------------------------');

if (unshieldedCount === 0) {
  console.log('🎉 Všetky výskyty Leva sú bezpečne ošetrené pred únikom do produkcie!\n');
  process.exit(0);
} else {
  console.log(`⚠️  Zistené ${unshieldedCount} nechránené použitie(a) Leva GUI.`);
  console.log('   Odporúčanie:');
  console.log('   V <Leva ... /> nastavte striktné skrývanie v produkcii:');
  console.log('   <Leva hidden={process.env.NODE_ENV === "production"} collapsed />\n');

  if (shouldFix) {
    console.log('🔧 Automatická oprava (--fix)...');
    // Ak je zadaný flag --fix a nájdeme components/gl/index.tsx
    const glFinding = findings.find(f => f.isGlComponent && !f.isGuarded);
    if (glFinding) {
      const glPath = path.join(ROOT_DIR, 'components/gl/index.tsx');
      let glContent = fs.readFileSync(glPath, 'utf8');
      if (glContent.includes('<Leva collapsed={false} />')) {
        glContent = glContent.replace(
          '<Leva collapsed={false} />',
          '<Leva collapsed hidden={process.env.NODE_ENV === "production"} />'
        );
        fs.writeFileSync(glPath, glContent, 'utf8');
        console.log('   ✅ components/gl/index.tsx bol úspešne upravený: pridaný hidden={process.env.NODE_ENV === "production"}');
      }
    }
  }

  if (isStrict) {
    console.error('❌ STRICT MODE: Zlyhanie auditu kvôli nechránenému Leva debug panelu.');
    process.exit(1);
  } else {
    process.exit(0);
  }
}
