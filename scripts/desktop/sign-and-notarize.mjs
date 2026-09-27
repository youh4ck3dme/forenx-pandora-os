#!/usr/bin/env node

/**
 * 🔏 PΛND0RΛ Forensic OS — Desktop Code Signing & Apple Notarization Automator
 *
 * Automatizuje proces podpisovania (Authenticode / Apple Developer ID) a notarizácie:
 * 1. Windows: CSC_LINK, CSC_KEY_PASSWORD, signtool / electron-builder
 * 2. macOS: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, notarytool
 * 3. Preflight kontrola existencie dist-electron/ a výstupných binárok
 * 4. Graceful --dry-run režim pre lokálny vývoj a CI bez tajomstiev
 *
 * Použitie:
 *   node scripts/desktop/sign-and-notarize.mjs --dry-run
 *   node scripts/desktop/sign-and-notarize.mjs --platform=win
 *   node scripts/desktop/sign-and-notarize.mjs --platform=mac
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';

const platformArg = args.find((a) => a.startsWith('--platform='));
const targetPlatform = platformArg
  ? platformArg.split('=')[1].toLowerCase()
  : process.platform === 'win32'
  ? 'win'
  : process.platform === 'darwin'
  ? 'mac'
  : 'linux';

console.log('\n=======================================================');
console.log('  🔏 PΛND0RΛ FORENSIC DESKTOP - SIGN & NOTARIZE');
console.log('=======================================================\n');
console.log(`Režim:    ${isDryRun ? '🧪 DRY-RUN (Simulácia)' : '🚀 LIVE SIGNING'}`);
console.log(`Platforma: ${targetPlatform.toUpperCase()}`);

const rootDir = process.cwd();
const distElectronDir = path.join(rootDir, 'dist-electron');
const distOutputDir = path.join(rootDir, 'dist');

// 1. Preflight kontrola dist-electron/
console.log('\n🔍 Krok 1: Preflight kontrola zostavených Electron artefaktov...');
if (!fs.existsSync(distElectronDir)) {
  console.warn('⚠️  Priečinok dist-electron/ neexistuje.');
  console.log('   Pred podpisovaním spustite zostavenie:');
  console.log('   npx tsc -p electron/tsconfig.json && npx tsc -p electron/tsconfig.preload.json\n');
  if (!isDryRun) {
    process.exit(1);
  }
} else {
  const mainMjs = path.join(distElectronDir, 'main.mjs');
  const preloadFile = fs.existsSync(path.join(distElectronDir, 'preload.mjs'))
    ? path.join(distElectronDir, 'preload.mjs')
    : path.join(distElectronDir, 'preload.js');
  if (fs.existsSync(mainMjs) && fs.existsSync(preloadFile)) {
    console.log('✅ dist-electron/ obsahuje platný main.mjs a ' + path.basename(preloadFile) + '.');
  } else {
    console.warn('⚠️  dist-electron/ existuje, ale chýbajú skompilované výstupy main.mjs/preload.mjs.');
  }
}

let missingCredentials = 0;

// 2. Kontrola poverení podľa platformy
if (targetPlatform === 'win' || targetPlatform === 'all') {
  console.log('\n🪟 Krok 2: Kontrola podpisových certifikátov pre Windows (Authenticode)...');
  const cscLink = process.env.CSC_LINK || process.env.WIN_CSC_LINK;
  const cscKeyPassword = process.env.CSC_KEY_PASSWORD || process.env.WIN_CSC_KEY_PASSWORD;

  if (cscLink && cscKeyPassword) {
    console.log('✅ Windows certifikát (CSC_LINK / WIN_CSC_LINK) je nakonfigurovaný.');
    if (!isDryRun) {
      console.log('⚡ Spúšťam electron-builder pre Windows s podpisovaním...');
      execSync('npx electron-builder --win --publish never', { stdio: 'inherit' });
    }
  } else {
    console.log('⚠️  Chýbajú premenné CSC_LINK alebo CSC_KEY_PASSWORD.');
    console.log('   Pre produkčné podpisovanie Windows inštalátora (.exe / NSIS) nastavte:');
    console.log('   - CSC_LINK (cesta k .pfx súboru alebo base64 reťazec certifikátu)');
    console.log('   - CSC_KEY_PASSWORD (heslo k privátnemu kľúču certifikátu)');
    missingCredentials++;
  }
}

if (targetPlatform === 'mac' || targetPlatform === 'all') {
  console.log('\n🍏 Krok 3: Kontrola poverení pre macOS Notarization (Apple Notary Service)...');
  const appleId = process.env.APPLE_ID;
  const appleAppSpecificPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  if (appleId && appleAppSpecificPassword && appleTeamId) {
    console.log('✅ Apple Notarization poverenia (APPLE_ID, TEAM_ID) sú nakonfigurované.');
    if (!isDryRun) {
      console.log('⚡ Spúšťam electron-builder pre macOS a notarizáciu cez notarytool...');
      execSync('npx electron-builder --mac --publish never', { stdio: 'inherit' });
    }
  } else {
    console.log('⚠️  Chýbajú premenné pre Apple Notarization.');
    console.log('   Pre produkčnú notarizáciu macOS balíka (.dmg) nastavte:');
    console.log('   - APPLE_ID (vývojársky Apple ID email)');
    console.log('   - APPLE_APP_SPECIFIC_PASSWORD (aplikačné heslo vygenerované na appleid.apple.com)');
    console.log('   - APPLE_TEAM_ID (10-miestne Apple Developer Team ID)');
    missingCredentials++;
  }
}

console.log('\n-------------------------------------------------------');
if (missingCredentials === 0) {
  console.log('🎉 VŠETKY PODPISOVÉ POŽIADAVKY SÚ SPLNENÉ!\n');
  process.exit(0);
} else {
  if (isDryRun) {
    console.log(`ℹ️  DRY-RUN DOKONČENÝ: Zistené ${missingCredentials} chýbajúce certifikačné položky.`);
    console.log('   V dry-run režime je návratový kód 0.\n');
    process.exit(0);
  } else {
    console.error(`❌ CHÝBAJÚCE CERTIFIKÁTY: ${missingCredentials} premenných chýba pre ostré podpisovanie.`);
    console.log('   Pre testovací beh bez certifikátov použite flag: --dry-run\n');
    process.exit(1);
  }
}
