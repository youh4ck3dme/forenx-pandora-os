#!/usr/bin/env node
// Vypíše markdown tabuľku z Playwright JSON reportu smoke behu.
// Použitie: node e2e/smoke/summarize.mjs test-results/smoke-full.json
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "test-results/smoke-full.json";
const report = JSON.parse(readFileSync(file, "utf8"));
const rows = [];
const walk = (suite) => {
  for (const s of suite.suites ?? []) walk(s);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const r = t.results?.at(-1) ?? {};
      const seen = new Set();
      const ann = (t.annotations ?? []).concat(r.annotations ?? []).filter((a) => {
        const k = `${a.type}\u0000${a.description}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
      const pick = (type) => ann.filter((a) => a.type === type).map((a) => a.description).join(" ; ");
      const err = (r.errors ?? r.error ? [r.error] : []).filter(Boolean)[0]?.message ?? r.errors?.[0]?.message ?? "";
      rows.push({
        title: spec.title,
        status: t.status === "expected" ? "PASS" : t.status === "skipped" ? "SKIP" : "FAIL",
        result: pick("result"),
        notes: [pick("note"), pick("page-errors"), pick("console-errors"), pick("benign-console"), pick("blocked-writes"), pick("axe"), pick("skip")]
          .filter(Boolean)
          .join(" ; "),
        error: err.replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 6).join(" ").slice(0, 400),
      });
    }
  }
};
for (const s of report.suites ?? []) walk(s);
const esc = (v) => String(v ?? "").replace(/\|/g, "\\|");
console.log("| Test | Výsledok | Detail | Poznámky / chyba |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${esc(r.title)} | ${r.status} | ${esc(r.result)} | ${esc(r.notes || r.error)} |`);
