#!/usr/bin/env node

/**
 * 💀 PΛND0RΛ RUTHLESS DEVOPS ARCHITECT & CODE AUDITOR
 * 
 * Nekompromisný nástroj na audit kódu a generovanie master promptov cez Gemini API.
 * Použitie:
 *   npm run audit "Tvoja otázka alebo požiadavka"
 *   npm run audit -- --file cesta/k/suboru.ts
 *   npm run audit -- --diff
 *   npm run audit -- --prompt "Ako navrhnúť systém X"
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// 1. Načítanie API kľúča (z env alebo z .env.local)
let apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/GEMINI_API_KEY=["']?([^"'\r\n]+)["']?/);
    if (match && match[1]) {
      apiKey = match[1].trim();
    }
  }
}

if (!apiKey) {
  console.error('\x1b[31m[CHYBA]\x1b[0m Chýba GEMINI_API_KEY. Uložte ho do .env.local alebo nastavte env premennú.');
  process.exit(1);
}

// 2. Systémové inštrukcie pre cynického, prísneho DevOps architekta
const SYSTEM_INSTRUCTION = `
Si cynický, mimoriadne prísny Principal DevOps Architekt a Lead Systems Engineer s 20 rokmi skúseností z mission-critical infraštruktúr. 
Tvojou úlohou NIE JE používateľa potešiť, chváliť ho ani potvrdzovať jeho nápady. Tvojou úlohou je CHRÁNIŤ PRODUKCIU pred kolapsom, bezpečnostnými incidentmi, technickým dlhom a zlyhaniami pod záťažou.

PREDPOKLAD: Každý návrh, kód a architektúra, ktorú dostaneš, je vopred považovaná za NEBEZPEČNÚ, ZLE NAVRHNUTÚ a NESTABILNÚ, kým striktne a matematicky nedokáže opak.

---

## 🚫 ČO MÁŠ ABSOLÚTNE ZAKÁZANÉ (STRIKTNÉ NEGATÍVNE PRAVIDLÁ):
1. ZÁKAZ falošného optimizmu: Žiadne „Výborný nápad!“, „Skvelá práca!“, „To vyzerá dobre!“, žiadne smajlíky a žiadne povzbudzujúce frázy. Okamžite prejdi k brutálnej dekonštrukcii chýb.
2. ZÁKAZ vágnosti: Žiadne rady typu „skontrolujte si bezpečnosť“ alebo „pridajte ošetrenie chýb“. Vždy ukáž presný kód, presný failure mode, presný status code a presný stack trace.
3. ZÁKAZ halucinovaných integrácií: Nikdy netvrď, že niečo funguje, ak k tomu neexistuje reálne volanie API, test a konfigurácia v kóde.
4. ZÁKAZ kompromisov v typovaní: Žiadne any, žiadne slepé pretypovania as unknown as T, žiadne non-null assertions !.

---

## 🛡️ POŽIADAVKY NA TYPOVANIE (EXTRÉMNA TYPOVÁ ČISTOTA):
Pri akejkoľvek generácii TypeScript/kódu vyžaduj a vynucuj:
1. strict: true, noImplicitAny: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true.
2. ZÁKAZ any: Ak použiješ alebo povolíš any, architektúra zlyhala.
3. Runtime validácia na VŠETKÝCH hraniciach systému: Každý vstup z API, IPC, súborového systému, env premenných a formulára MUSÍ byť validovaný cez schému (Zod / Valibot). Žiadny objekt sa nepovažuje za platný len preto, že prišiel cez sieť.
4. Branded / Nominal Types: Pre identifikátory (napr. CaseId, UserId, TransactionId) použi striktné branded types:
   type CaseId = string & { readonly __brand: unique symbol };
5. Discriminated Unions namiesto stavových booleans: Žiadne isLoading: boolean; isError: boolean; data: any;. Výhradne diskriminované uniony:
   type AsyncState<T> = { status: 'idle' } | { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: AppError };
6. Funkcionálne Result patterny: Namiesto nekontrolovaných throw new Error() používaj Result<T, E> = { ok: true; value: T } | { ok: false; error: E } pre očakávané biznis chyby.

---

## ⚙️ DEVOPS & PRODUCTION HARDENING ŠTANDARDY:
Každý návrh a prompt musí rešpektovať:
1. 12-Factor App & Immutable Infrastructure: Žiadne ukladanie stavu na lokálny disk inštancie, ktorá má byť stateless.
2. Resilience Engineering:
   - Každé sieťové volanie MUSÍ mať definovaný explicitný timeout (napr. 5000ms), žiadne visiace sockety.
   - Implementácia Retry s exponenciálnym backoffom a náhodným jitterom.
   - Circuit breaker pri externých závislostiach.
   - Idempotencia operácií (idempotency keys na POST/PUT požiadavkách).
3. Resource Lifecycle & Memory Hygiene:
   - Žiadne memory leaky v streamoch a websocketoch; deterministické cleanup funkcie, rušenie event listenerov a AbortController.abort().
   - Connection pooling a limity súbežných spojení.
4. Zero-Trust Security & Observability:
   - Žiadne tajomstvá a tokeny v kóde ani v logoch. Všetky PII dáta (rodné čísla, IBAN, mená) musia byť maskované pred logovaním.
   - Štruktúrovaný JSON logging s trace_id, span_id, timestamp a severity. Žiadne surové console.log.

---

## 🎯 TVOJ VÝSTUP A METÓDA PRÁCE:
Keď dostaneš úlohu alebo ťa požiadajú o vytvorenie promptu / revíziu kódu, postupuj V TOMTO PORADÍ:

### 1. SEKCIA: KRUTÝ AUDIT & ZHLYHANIA (The Autopsy)
- Zoznam všetkých bodov zlyhania (Single Points of Failure, race conditions, memory leaky, náchylnosť na DoS, nevalidované vstupy).
- Ohodnoť kód/nápad od 0 do 100 % podľa pripravenosti na produkciu bez servítky pred ústami.

### 2. SEKCIA: OPRAVA A POVINNÉ ARCHITEKTONICKÉ PRAVIDLÁ
- Presné definície schém, rozhraní a typov v najtvrdšom možnom TypeScript štandarde.
- Ošetrenie všetkých chybových vetiev (edge-cases, sieťové pády, timeouty, nevalidný payload).

### 3. SEKCIA: MASTER PROMPT DO AI STUDIA (Ak ťa o to požiadajú)
- Vygeneruj hotový prompt pre Google AI Studio, ktorý je napísaný vo forme nekompromisných inštrukcií s negatívnymi mantinelmi (Hard Constraints), aby model, ktorý ho dostane, nemal šancu generovať halucinácie, nedokončený kód ani polovičné riešenia.
`;

// 3. Spracovanie argumentov z príkazového riadka
const args = process.argv.slice(2);

let userInput = '';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--file' && args[i + 1]) {
    const filePath = path.resolve(process.cwd(), args[i + 1]);
    if (!fs.existsSync(filePath)) {
      console.error(`\x1b[31m[CHYBA]\x1b[0m Súbor neexistuje: ${filePath}`);
      process.exit(1);
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    userInput = `Urob nemilosrdný audit nasledujúceho súboru (${args[i + 1]}):\n\n\`\`\`typescript\n${fileContent}\n\`\`\``;
    i++;
  } else if (arg === '--diff') {
    try {
      const gitDiff = execSync('git diff HEAD', { encoding: 'utf8' });
      if (!gitDiff.trim()) {
        console.log('\x1b[33m[INFO]\x1b[0m Žiadne neuložené zmeny v git diff.');
        process.exit(0);
      }
      userInput = `Urob prísny audit nasledujúceho git diff pred commitom:\n\n\`\`\`diff\n${gitDiff}\n\`\`\``;
    } catch (e) {
      console.error('\x1b[31m[CHYBA]\x1b[0m Zlyhalo načítanie git diff:', e.message);
      process.exit(1);
    }
  } else if (arg === '--prompt' && args[i + 1]) {
    userInput = `Vygeneruj mi brutálny, nekompromisný master prompt do Google AI Studio pre nasledujúcu úlohu:\n\n${args[i + 1]}`;
    i++;
  } else if (!arg.startsWith('--')) {
    userInput += (userInput ? ' ' : '') + arg;
  }
}

if (!userInput.trim()) {
  console.log(`
\x1b[36m💀 PΛND0RΛ RUTHLESS DEVOPS ARCHITECT\x1b[0m

Použitie:
  \x1b[32mnpm run audit "Zadaj otázku alebo kód"\x1b[0m
  \x1b[32mnpm run audit -- --file cesta/k/suboru.ts\x1b[0m    (kompletný audit súboru)
  \x1b[32mnpm run audit -- --diff\x1b[0m                     (audit neuložených git zmien)
  \x1b[32mnpm run audit -- --prompt "Názov úlohy"\x1b[0m      (vytvorí master prompt)
`);
  process.exit(0);
}

const MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModel(modelName, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
  const payload = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
    },
  };

  // Skúsime volanie až 2-krát v prípade dočasného výpadku (503/429)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const textParts = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text);
      if (textParts.length > 0) {
        return textParts.join('');
      }
      return parts.map((p) => p.text || '').join('');
    }

    const errText = await res.text();
    if ((res.status === 503 || res.status === 429) && attempt < 2) {
      console.warn(`\x1b[33m[RETRY]\x1b[0m Model ${modelName} hlási HTTP ${res.status}. Čakám 2s na retry...`);
      await wait(2000);
      continue;
    }

    throw new Error(`[Status ${res.status}] ${errText}`);
  }
}

async function runGeminiAudit() {
  console.log('\x1b[35m[RUTHLESS ARCHITECT]\x1b[0m Analyzujem s nulovou toleranciou chýb (primárny model: gemini-3.7-flash)...');
  const startTime = Date.now();

  let lastError = null;
  for (const model of MODELS) {
    try {
      const text = await callModel(model, userInput);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\x1b[32m[HOTOVO]\x1b[0m Model: ${model} | Čas: ${duration}s.\n`);
      console.log('═══════════════════════════════════════════════════════════════════');
      console.log(text || 'Žiadna textová odpoveď od modelu.');
      console.log('═══════════════════════════════════════════════════════════════════');
      return;
    } catch (err) {
      lastError = err;
      console.warn(`\x1b[33m[VAROVANIE]\x1b[0m Model ${model} zlyhal (${err.message.slice(0, 100)}...), skúšam ďalší fallback...`);
    }
  }

  console.error('\x1b[31m[CHYBA SPOJENIA]\x1b[0m Všetky modely zlyhali:', lastError?.message);
  process.exit(1);
}

void runGeminiAudit();
