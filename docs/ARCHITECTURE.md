# PΛND0RΛ Browser - Systémová Architektúra (Architecture Guide)

> Kanonický kontrakt celkového správania aplikácie je v [System Source of Truth](SOURCE-OF-TRUTH.md). Tento dokument rozvíja technické detaily a nesmie s ním byť v rozpore.

Tento dokument detailne popisuje technickú architektúru, dátové toky, komponenty a návrhové vzory prehliadača **PΛND0RΛ Browser**.

---

## 1. Prehľad Architektúry (Architectural Overview)

PΛND0RΛ Browser je navrhnutý ako hybridná moderná platforma integrujúca:
- **Webový PWA frontend** na báze Next.js 15 App Router s React 18 a Tailwind CSS v4.
- **Desktopový shell** na báze Electron 39 s oddeleným hlavným a renderovacím procesom cez bezpečný `contextBridge`.
- **Mobilný runtime kontajner** cez Capacitor 8 pre natívne zostavenia na Android a iOS.
- **Lokálnu AI inteligenciu** cez Mistral AI s real-time SSE streamovaním a zero-leak bezpečnosťou kľúčov.

```
+---------------------------------------------------------------+
|                    PΛND0RΛ Browser UI                         |
|  (Next.js 15 App Router / Tailwind CSS v4 / React 18)         |
+-------------------------------+-------------------------------+
|      Browser Features         |       Workspace & Suites      |
|  - Tabs & Drag-Drop           |  - Forza Forensic Analytics   |
|  - Omnibox & Search           |  - Forge Studio (PWA Editor)  |
|  - Mistral AI Copilot         |  - WebGL Particle Waves       |
|  - Shield & AdBlock           |  - Modern Dock Navigation     |
+-------------------------------+-------------------------------+
|                      Aplikačné Služby                         |
|   - ai-service (Mistral)     - search-service                |
|   - wallet-service           - storage-service (idb-keyval)   |
+---------------------------------------------------------------+
|              Globálny State & Perzistencia                    |
|   - Zustand Store (browser-store)                             |
|   - IndexedDB (História, Záložky, Spaces)                     |
|   - LocalStorage (lokálne kľúče pandora_mistral_key)          |
+-------------------------------+-------------------------------+
|     Electron Desktop Shell    |     Capacitor Mobile Shell    |
|  - Main Process (Electron 39) |  - Android & iOS WebViews     |
|  - IPC Context Bridge         |  - Natívne pluginy            |
|  - Ghostery AdBlocker Engine  |                               |
+-------------------------------+-------------------------------+
```

---

## 2. Dátové toky a Správa Stavu (State & Data Flow)

### 2.1 Zustand Global Store (`lib/store/browser-store.ts`)
Stav celého prehliadača je centralizovaný v reaktívnom Zustand store:
- **Taby & Okná**: Zoznam otvorených tabov, aktívny tab, história naposledy zatvorených tabov pre funkciu znovuotvorenia (`reopenTab`).
- **Pracovné priestory (Spaces)**: Izolované kontexty (*Default*, *Work*, *Dev*) zabraňujúce miešaniu pracovných a súkromných aktivít.
- **Konfigurácia AI & Služieb**:
  - `mistralApiKey`: Bezpečne spravovaný API kľúč pre Mistral AI.
  - `shieldEnabled`: Stav integrovaného blokovania reklám a sledovačov.
  - `copilotOpen`: Prepínač zobrazenia inteligentného asistenta.

### 2.2 Perzistencia dát (`lib/storage/` a `idb-keyval`)
- Dátovo náročné štruktúry (história prehliadania, záložky, forenzné projekty) sú ukladané asynchrónne do prehliadačového **IndexedDB**.
- Používateľské nastavenia a kľúče sú ukladané do `localStorage` s okamžitým načítaním pri štarte aplikácie.

---

## 3. Integrácia Mistral AI (`lib/services/ai-service.ts`)

AI vrstva bola plne migrovaná na **Mistral AI** s dôrazom na rýchlosť a súkromie:

```
[Používateľ / Chat UI]
         │
         ▼
[useCopilotChat Hook]
         │
         ├── Uloženie správy do lokálneho stavu
         │
         ▼
[AIService.generateCompletion / stream]
         │
         ├── Príprava payloadu (model: mistral-large-latest, stream: true)
         ├── Injekcia kontextu aktívnej webovej stránky (Page Context)
         │
         ▼
[POST https://api.mistral.ai/v1/chat/completions]
         │
         ▼ (SSE Stream - data: {...})
[readStream Chunk Processing]
         │
         └── Inkrementálny render odpovede v reálnom čase do UI
```

### Bezpečnosť API kľúčov:
- Kľúč `pandora_mistral_key` je uchovávaný výhradne na strane klienta.
- Žiadny serverový proxy nekontroluje ani nezaznamenáva požiadavky používateľa – komunikácia prebieha napriamo medzi prehliadačom a koncovým bodom Mistral API.

---

## 4. Vizuálny a Grafický Systém (Visuals & Shaders)

### 4.1 3D WebGL Particle Wave (`components/malte/welcome-particles.tsx`)
Pre ambientné podfarbenie aplikácie bez rušivých prvkov bol vytvorený vlastný WebGL canvas:
- Využíva natívny WebGL kontext s vlastnými vertex a fragment shadermi pre generovanie matematickej vlny častíc.
- Automaticky reaguje na veľkosť okna (`ResizeObserver`) a prispôsobuje sa pixel ratio displeja.
- Výpočtovo optimalizovaný pre 60 FPS s nízkou záťažou procesora a grafickej karty.

### 4.2 Tailwind CSS v4 & Responzívny Layout
- Použitie najnovšej generácie Tailwind CSS v4 s definíciou premenných v `@layer base`.
- Vyriešené problémy s kolapsovou šírkou pravej strany: flexibilné kontajnery s `min-w-0` a stabilnými flex-grow pravidlami zaisťujú, že otvorenie bočných menu alebo nastavení nespôsobí stlačenie obsahu.

---

## 5. Bezpečnostná Architektúra (Security & Shield)

1. **Context Isolation (Electron)**: Hlavný proces a renderovací proces komunikujú výhradne cez striktne typovaný `preload.ts` s použitím `contextBridge.exposeInMainWorld`.
2. **AdBlock & Tracker Shield**: Webové požiadavky sú filtrované v reálnom čase enginom `@ghostery/adblocker-electron`.
3. **WebAuthn Biometria**: Natívna podpora Passkeys pre lokálnu autentifikáciu používateľa bez nutnosti zadávania textových hesiel.
4. **Graceful Supabase Fallback**: V prípade lokálneho vývoja bez nakonfigurovaných Supabase kľúčov aplikácia automaticky prejde do offline mock režimu bez pádov.

---

## 6. Testovanie a Overovanie Kvality (Quality & Testing)

Projekt má nastavené prísne pravidlá pre kvalitu kódu:
- **Testovací framework**: Vitest v4 s JSDOM prostredím a mockmi pre prehliadačové a Electron API.
- **Aktuálny stav**: **129/129 testov prechádza** bez chýb.
- **Pokrytie**:
  - `ai-service.test.ts`: Testovanie Mistral endpointov, spracovania chýb a payloadov.
  - `browser-store.test.ts`: Správa stavu prehliadača, navigácie a tabov.
  - `wallet-service.test.ts`, `search-service.test.ts`, `utils.test.ts`.
  - `forza/`: Parsovanie CSV, detekcia anomálií a forenzné algoritmy.
  - `forge/`: Komponenty vizuálneho štúdia a inšpektora.
- **Spustenie testov**:
  ```bash
  npx vitest run
  ```
