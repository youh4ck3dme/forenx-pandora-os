#!/usr/bin/env node
/**
 * Produkčné ENV premenné odvodené z .env.production.example.
 *
 *   node scripts/deploy/env.mjs vercel            → príkazy `vercel env add … production`
 *   node scripts/deploy/env.mjs template          → šablóna .env.production (prázdne hodnoty)
 *   node scripts/deploy/env.mjs check <súbor>     → kontrola vyplneného súboru
 *
 * Skript NIKDY nevypisuje hodnoty premenných — iba názvy a stav.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXAMPLE = path.join(ROOT, ".env.production.example");

/** Tajné hodnoty — iba server, nikdy s prefixom NEXT_PUBLIC_. */
export const SECRET = new Set([
  "SUPABASE_SERVICE_ROLE_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "MISTRAL_API_KEY",
  "MISTRAL_API_KEY_CHAT",
  "MISTRAL_API_KEY_ANALYSIS",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "WHOISWHO_API_KEY",
  "ICO_ATLAS_API_KEY",
  "FORENX_AI_WORKER_KEY",
  "CRON_SECRET",
]);

/** Bez týchto produkcia nefunguje (vault v produkcii bez S3 zámerne zlyhá). */
export const REQUIRED = [
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];

/**
 * Mistral: spoločný MISTRAL_API_KEY, alebo OBA dedikované kľúče. Runtime ich nemieša —
 * chat číta len _CHAT, analýza/OCR len _ANALYSIS (spoločný kľúč je fallback pre oba).
 */
export const MISTRAL_ANY = ["MISTRAL_API_KEY", "MISTRAL_API_KEY_CHAT", "MISTRAL_API_KEY_ANALYSIS"];

/** Premenné, ktoré kód číta, hoci v šablóne nie sú. */
const EXTRA = ["MISTRAL_API_KEY_CHAT", "MISTRAL_API_KEY_ANALYSIS", "FORENX_ADMIN_EMAILS", "CRON_SECRET"];

/** Nesmie byť nastavené v produkcii (fallback vault je v produkcii zakázaný). */
export const FORBIDDEN_IN_PRODUCTION = ["VAULT_FALLBACK_SECRET"];

const PLACEHOLDER = /your[-_]|placeholder|changeme|example\.(com|invalid)|xxx|<[^>]*>|\.\.\.|…/i;
const isPlaceholder = (key, value) => {
  // Hetzner's documented S3 hostname literally contains "your-objectstorage".
  if (key === "S3_ENDPOINT" && /^https:\/\/[a-z0-9-]+\.your-objectstorage\.com(?:\/|$)/i.test(value)) {
    return false;
  }
  return PLACEHOLDER.test(value);
};

export function parseEnv(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2] ?? "";
    const quoted = value.match(/^(['"])(.*)\1\s*(?:#.*)?$/);
    value = quoted
      ? (quoted[2] ?? "")
      : value.startsWith("#")
        ? ""
        : value.replace(/\s+#.*$/, "").trim();
    out.set(match[1], value);
  }
  return out;
}

export function exampleKeys(text = fs.readFileSync(EXAMPLE, "utf8")) {
  const keys = [...parseEnv(text).keys()];
  for (const key of EXTRA) if (!keys.includes(key)) keys.push(key);
  return keys;
}

export function classify(key) {
  if (SECRET.has(key)) return "secret";
  if (key.startsWith("NEXT_PUBLIC_")) return "public";
  return "config";
}

/** Vráti zoznam problémov; hodnoty v ňom nikdy nie sú. */
export function checkEnv(env, keys) {
  const problems = [];
  const has = (key) => (env.get(key) ?? "").length > 0;
  for (const key of REQUIRED) {
    if (!has(key)) problems.push({ level: "error", key, issue: "chýba alebo je prázdna (povinná)" });
  }
  if (!MISTRAL_ANY.some(has)) {
    problems.push({ level: "error", key: MISTRAL_ANY.join(" | "), issue: "nie je nastavený žiadny Mistral kľúč" });
  } else if (!has("MISTRAL_API_KEY")) {
    for (const key of ["MISTRAL_API_KEY_CHAT", "MISTRAL_API_KEY_ANALYSIS"]) {
      if (!has(key)) {
        problems.push({ level: "error", key, issue: "bez MISTRAL_API_KEY treba oba dedikované kľúče (chat aj analýza)" });
      }
    }
  }
  for (const [key, value] of env) {
    if (value && isPlaceholder(key, value)) {
      problems.push({ level: "error", key, issue: "vyzerá ako placeholder zo šablóny" });
    }
    if (key.startsWith("NEXT_PUBLIC_") && SECRET.has(key.slice("NEXT_PUBLIC_".length))) {
      problems.push({ level: "error", key, issue: "tajný kľúč s prefixom NEXT_PUBLIC_ by sa dostal do prehliadača" });
    }
    if (!keys.includes(key) && !FORBIDDEN_IN_PRODUCTION.includes(key)) {
      problems.push({ level: "warn", key, issue: "nie je v .env.production.example (preklep?)" });
    }
  }
  for (const key of FORBIDDEN_IN_PRODUCTION) {
    if (has(key)) problems.push({ level: "error", key, issue: "nemá byť v produkcii nastavená" });
  }
  const pub = env.get("NEXT_PUBLIC_SUPABASE_URL");
  const srv = env.get("SUPABASE_URL");
  if (pub && srv && pub !== srv) {
    problems.push({ level: "error", key: "SUPABASE_URL", issue: "nezhoduje sa s NEXT_PUBLIC_SUPABASE_URL" });
  }
  const cron = env.get("CRON_SECRET");
  if (cron && cron.length < 32) {
    problems.push({ level: "error", key: "CRON_SECRET", issue: "musí mať aspoň 32 znakov (kratší endpoint odmietne)" });
  }
  const base = env.get("NEXT_PUBLIC_BASE_URL");
  if (base && !base.startsWith("https://")) {
    problems.push({ level: "error", key: "NEXT_PUBLIC_BASE_URL", issue: "musí začínať https://" });
  }
  return problems;
}

const GROUPS = [
  ["public", "Verejné (NEXT_PUBLIC_*) — zapečú sa do buildu, po zmene treba NOVÝ build"],
  ["config", "Serverová konfigurácia (nie tajná)"],
  ["secret", "TAJNÉ — iba server; hodnotu zadaj interaktívne, nikdy do príkazu ani chatu"],
];

function grouped(keys) {
  return GROUPS.map(([kind, title]) => [title, keys.filter((key) => classify(key) === kind)]);
}

function printVercel(keys) {
  console.log("# Vercel — každý príkaz sa interaktívne spýta na hodnotu.");
  console.log("# Existujúcu premennú najprv odstráň: vercel env rm NAZOV production");
  for (const [title, list] of grouped(keys)) {
    console.log(`\n# ── ${title}`);
    for (const key of list) {
      const required = REQUIRED.includes(key) ? "   # POVINNÁ" : "";
      console.log(`vercel env add ${key} production${required}`);
    }
  }
  console.log("\n# Potom: vercel --prod");
}

function printTemplate(keys) {
  console.log("# .env.production — VPS. chmod 600, vlastník = používateľ aplikácie, NIKDY do gitu.");
  console.log("# Načíta ho PM2 cez node_args --env-file (ecosystem.config.cjs).");
  for (const [title, list] of grouped(keys)) {
    console.log(`\n# ── ${title}`);
    for (const key of list) {
      const required = REQUIRED.includes(key) ? "  # POVINNÁ" : "";
      console.log(`${key}=${required}`);
    }
  }
  console.log("\n# Mistral: MISTRAL_API_KEY, alebo oba MISTRAL_API_KEY_CHAT a MISTRAL_API_KEY_ANALYSIS.");
  console.log(`# Nenastavuj: ${FORBIDDEN_IN_PRODUCTION.join(", ")}.`);
}

function runCheck(file) {
  if (!file || !fs.existsSync(file)) {
    console.error(`Súbor neexistuje: ${file ?? "(nezadaný)"}`);
    process.exit(2);
  }
  const env = parseEnv(fs.readFileSync(file, "utf8"));
  const problems = checkEnv(env, exampleKeys());
  if (process.platform !== "win32") {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode & 0o077) {
      problems.push({ level: "error", key: path.basename(file), issue: `práva ${mode.toString(8)} — nastav chmod 600` });
    }
  }
  for (const p of problems) console.log(`${p.level === "error" ? "✗" : "!"} ${p.key}: ${p.issue}`);
  const errors = problems.filter((p) => p.level === "error").length;
  const set = [...env.values()].filter(Boolean).length;
  console.log(`\n${set} premenných nastavených, ${errors} chýb, ${problems.length - errors} varovaní.`);
  process.exit(errors > 0 ? 1 : 0);
}

function main() {
  const [command, file] = process.argv.slice(2);
  const keys = exampleKeys();
  if (command === "vercel") printVercel(keys);
  else if (command === "template") printTemplate(keys);
  else if (command === "check") runCheck(file);
  else {
    console.log("Použitie: node scripts/deploy/env.mjs <vercel | template | check <súbor>>");
    process.exit(command ? 2 : 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
