import http from "node:http";
import https from "node:https";

const BASE_URL = process.env.TEST_BASE_URL || "https://pandora.whoiswho.at";

const routes = [
  // 1. Core Web & Browser
  "/",
  "/browser/",
  "/offline/",
  
  // 2. Authentication
  "/auth/login/",
  "/auth/register/",
  
  // 3. Blog & Content (SSG)
  "/blog/",
  "/blog/bezpecnost-prehliadacov-a-izolacia/",
  "/blog/sukromie-a-ochrana-proti-fingerprintingu/",
  "/blog/forenzna-analyza-financnych-tokov/",
  
  // 4. Forge Studio (PWA Visual Editor)
  "/forge/",
  
  // 5. Forza Forensic Suite
  "/forza/",
  "/forza/prehlad/",
  "/forza/pripady/",
  "/forza/analyza-vypisov/",
  "/forza/asistent/",
  "/forza/import-csv/",
  "/forza/mcp-info/",
  "/forza/osoby/",
  "/forza/pravny-kontext/",
  "/forza/predplatne/",
  "/forza/profil/",
  "/forza/sandbox/",
  "/forza/siet/",
  "/forza/stav/",
  "/forza/sukromie/",
  "/forza/viac/",
  "/forza/vzhlad/",
  "/forza/vztahy/",
  "/forza/zbrane/",
  
  // 6. API Endpoints
  "/api/vault"
];

async function checkEndpoint(path) {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();
  
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "PANDORA-E2E-Auditor/2.0",
        "Accept": "text/html,application/json,*/*"
      }
    });
    
    const latency = Date.now() - start;
    const contentType = res.headers.get("content-type") || "";
    const isOk = res.status >= 200 && res.status < 400;
    
    return {
      path,
      url,
      status: res.status,
      latency,
      contentType: contentType.split(";")[0],
      ok: isOk,
      headers: {
        server: res.headers.get("server"),
        xVercelId: res.headers.get("x-vercel-id"),
        xFrameOptions: res.headers.get("x-frame-options")
      }
    };
  } catch (err) {
    return {
      path,
      url,
      status: "ERR",
      latency: Date.now() - start,
      ok: false,
      error: err.message
    };
  }
}

async function run() {
  console.log("\n=======================================================================");
  console.log(`  🌐 PΛND0RΛ FORENX OS — E2E ENDPOINTS AUDIT`);
  console.log(`  Target: ${BASE_URL}`);
  console.log("=======================================================================\n");

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const route of routes) {
    const result = await checkEndpoint(route);
    results.push(result);
    
    const statusIcon = result.ok ? "✅" : "❌";
    const statusStr = String(result.status).padEnd(4);
    const latencyStr = `${result.latency}ms`.padStart(7);
    const typeStr = (result.contentType || "unknown").padEnd(16);
    
    console.log(` ${statusIcon} [${statusStr}] ${latencyStr} | ${typeStr} | ${route}`);
    
    if (result.ok) passed++;
    else failed++;
  }

  console.log("\n-----------------------------------------------------------------------");
  console.log(`  Celkovo otestovaných: ${routes.length}`);
  console.log(`  ✅ Úspešné (200-308):  ${passed}`);
  console.log(`  ❌ Zlyhané:            ${failed}`);
  console.log("-----------------------------------------------------------------------\n");

  // Overenie API Vault špecifických volaní
  console.log("🔍 Testovanie /api/vault funkcionality:");
  try {
    const vaultValidationRes = await fetch(`${BASE_URL}/api/vault?action=unknown_action`);
    console.log(` - /api/vault (Zod zodpovedá na zlé parametre 400): ${vaultValidationRes.status === 400 ? '✅ 400 Bad Request (Správna validácia)' : vaultValidationRes.status}`);
    
    const vaultListRes = await fetch(`${BASE_URL}/api/vault?caseId=case-123&action=list`);
    console.log(` - /api/vault (List evidence items): HTTP ${vaultListRes.status} ${vaultListRes.ok ? '✅' : 'ℹ️'}`);
  } catch (e) {
    console.log(` - /api/vault detail test error: ${e.message}`);
  }

  console.log("\n🎉 E2E AUDIT DOKONČENÝ!\n");
}

run();
