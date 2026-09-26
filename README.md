# PΛND0RΛ Browser & OS

> **PΛND0RΛ Browser** je prémiový, na súkromie orientovaný webový prehliadač a hybridný pracovný operačný systém novej generácie. Spája moderné webové jadro (Next.js 15 App Router), natívnu desktopovú integráciu (Electron 39), mobilnú runtime podporu (Capacitor 8), lokálnu umelú inteligenciu (Mistral AI Copilot), forenznú analytickú platformu (Forza) a vizuálne vývojárske štúdio (Forge) v elegantnom cyberpunkovom vizuálnom prostredí.

---

## 📑 Obsah (Table of Contents)

1. [Prehľad Kľúčových Modulov](#-prehľad-kľúčových-modulov)
   - [1. Jadro Prehliadača (Browser Core)](#1-jadro-prehliadača-browser-core)
   - [2. Mistral AI Copilot & Skenovanie](#2-mistral-ai-copilot--skenovanie)
   - [3. 3D WebGL Ambient Shaders](#3-3d-webgl-ambient-shaders)
   - [4. Forza Forensic & Data Suite](#4-forza-forensic--data-suite)
   - [5. Forge Studio (PWA Visual Builder)](#5-forge-studio-pwa-visual-builder)
   - [6. Web3 & Krypto Peňaženka](#6-web3--krypto-peňaženka)
   - [7. Bezpečnosť, Shield & WebAuthn](#7-bezpečnosť-shield--webauthn)
2. [Technologický Stack](#-technologický-stack)
3. [Kompletná Mapa Trás (Routing Map)](#-kompletná-mapa-trás-routing-map)
4. [Štruktúra Projektu](#-štruktúra-projektu)
5. [Inštalácia a Spustenie](#-inštalácia-a-spustenie)
6. [Zoznam NPM Skriptov](#-zoznam-npm-skriptov)
7. [Premenné Prostredia (.env)](#-premenné-prostredia-env)
8. [Klávesové Skratky (Shortcuts)](#-klávesové-skratky-shortcuts)
9. [Testovanie a Kvalita Kódu](#-testovanie-a-kvalita-kódu)
10. [Licencia](#-licencia)

---

## 🚀 Prehľad Kľúčových Modulov

### 1. Jadro Prehliadača (Browser Core)
- **Multi-Tab Systém**: Otváranie, zatváranie, pripínanie (pin), duplikovanie, stlmenie zvuku (mute) a znovuotvorenie naposledy zatvorených tabov (`Ctrl+Shift+T`).
- **Drag-and-Drop Taby**: Plynulé preusporadúvanie tabov pomocou `@dnd-kit/core` a `@dnd-kit/sortable`.
- **Inteligentný Omnibox**: Univerzálny URL panel s automatickou detekciou vyhľadávacieho dotazu vs. validnej webovej adresy, podpora HTTPS formátovania a rýchle klávesové skratky.
- **Vyhľadávacie návrhy (Search Suggestions)**: Bezpečné integrované návrhy s vyrovnávacou pamäťou a fallbackom pri výpadku siete.
- **Izolované Pracovné Priestory (Spaces)**: Oddelenie kontextov (*Default*, *Work*, *Dev*) s nezávislými zoznamami otvorených tabov.
- **Bočný panel (Sidebar)**: Rýchly prístup k Záložkám (Bookmarks), Histórii prehliadania a Stiahnutým súborom.
- **Perzistentné úložisko**: História, záložky a stav tabov sú ukladané lokálne do prehliadačového **IndexedDB** cez `idb-keyval`.

### 2. Mistral AI Copilot & Skenovanie
- **Priama integrácia Mistral AI**: Podpora modelu `mistral-large-latest` cez oficiálny endpoint `https://api.mistral.ai/v1/chat/completions`.
- **Real-time SSE Streaming**: Plynulé postupné streamovanie tokenov v reálnom čase bez oneskorenia cez Server-Sent Events (`readStream`).
- **Page Context Injection**: Možnosť skenovania a extrakcie textového obsahu z aktuálne otvorenej webovej stránky (`@mozilla/readability`) pre okamžitú AI analýzu a sumarizáciu.
- **Zero-Leak Bezpečnosť kľúča**: API kľúč (`pandora_mistral_key`) sa ukladá výhradne do lokálneho `localStorage` v prehliadači používateľa a do Zustand store. Kľúč sa nikdy neposiela na externý server tretej strany.

### 3. 3D WebGL Ambient Shaders
- **Čistá fluidná particle animácia**: Optimalizovaný WebGL canvas komponent ([components/malte/welcome-particles.tsx](file:///c:/Users/magic/Documents/Projekty/pandora-browser-main/components/malte/welcome-particles.tsx)) vykresľujúci matematickú vlnu častíc.
- **Minimalistický vizuál**: Ambientné pozadie bez rušivých log, textov alebo statických bannerov.
- **Responzívny dock a flex stabilita**: Dokonale odladený layout zabraňujúci zmenšovaniu alebo deformácii pravej strany aplikácie pri otvorení bočných panelov a nastavení.

### 4. Forza Forensic & Data Suite
Komplexný balík analytických a vyšetrovacích nástrojov pre finančné toky, právny kontext a analýzu dát:
- **Analýza bankových výpisov (`/forza/analyza-vypisov`)**: Hĺbková kontrola transakcií, detekcia podozrivých tokov a anomálií.
- **Import a parsovanie CSV (`/forza/import-csv`)**: Podpora rôznych formátov dát, automatická detekcia stĺpcov, kódovania a chýb.
- **IČO Atlas & Entity Profiling (`/forza/osoby`)**: Prehľadávanie obchodných registrov, identifikácia subjektov a ich väzieb.
- **Analýza sietí a vzťahov (`/forza/siet`, `/forza/vztahy`)**: Grafová vizualizácia vzájomných prepojení medzi subjektmi a účtami.
- **Forenzný asistent (`/forza/asistent`)**: Špecializovaný AI asistent pre analýzu zmlúv a spisov.
- **Správa prípadov (`/forza/pripady`)**: Evidencia vyšetrovacích spisov, poznámok a priradených dôkazových materiálov.
- **Právny kontext (`/forza/pravny-kontext`)**: Prepojenie na legislatívu a judikatúru.
- **Izolovaný Sandbox (`/forza/sandbox`)**: Bezpečné prostredie pre experimentálne testovanie dátových tokov.
- **MCP Diagnostika (`/forza/mcp-info`)**: Prehľad integrácie s Model Context Protocol servermi.
- **Správa predplatného (`/forza/predplatne`)**: Stripe integrácia pre správu licencií a plánov.

### 5. Forge Studio (PWA Visual Builder)
- **Vizuálny Canvas (`/forge`)**: Drag-and-drop návrh a usporiadanie UI komponentov v reálnom čase.
- **Monaco Code Editor**: Integrovaný profesionálny editor kódu s priamou úpravou TypeScript/TSX štruktúr.
- **Strom elementov & Inspector**: Inšpekcia atribútov, CSS vlastností a stavov prvkov.
- **Export & Build**: Tlačidlo pre generovanie a balíčkovanie hotovej PWA aplikácie.

### 6. Web3 & Krypto Peňaženka
- **Sledovanie zostatkov (`lib/services/wallet-service.ts`)**: Podpora adries pre Ethereum a EVM siete pomocou `ethers`.
- **Cenové orakuly**: Automatické načítavanie trhových cien kľúčových kryptomien s inteligentným offline/fallback mechanizmom.

### 7. Bezpečnosť, Shield & WebAuthn
- **AdBlocker & Tracker Shield**: Blokovanie reklám a škodlivých skriptov v reálnom čase pomocou `@ghostery/adblocker-electron`.
- **WebAuthn (Passkeys)**: Biometrická registrácia a prihlásenie (Touch ID, Face ID, Windows Hello) bez nutnosti tradičných hesiel.
- **Graceful Supabase Fallback**: V prípade chýbajúcich Supabase environment premenných v lokálnom móde aplikácia nepadá, ale automaticky prepína do bezpečného offline mock režimu.

---

## 🛠️ Technologický Stack

| Vrstva | Technológie a Knižnice |
| :--- | :--- |
| **Jadro & Framework** | Next.js 15.2 (App Router), React 18, TypeScript 5 |
| **Štýlovanie & UI** | Tailwind CSS v4, Radix UI (shadcn/ui), Lucide React |
| **Vizuály & Grafika** | Framer Motion 12, Three.js, WebGL GLSL Shaders |
| **AI Integrácia** | Mistral AI API (`mistral-large-latest`), Vercel AI SDK (`ai`), SSE |
| **Správa Stavu** | Zustand, React Context, TanStack React Query 5 |
| **Dátová Perzistencia** | IndexedDB (`idb-keyval`), LocalStorage, flexsearch, better-sqlite3 |
| **Desktop Shell** | Electron 39, `electron-updater`, Ghostery AdBlocker |
| **Mobilný Shell** | Capacitor 8 (iOS & Android) |
| **Forenzné & Dátové nástroje** | `xlsx`, `pdfjs-dist`, `mammoth`, `@xyflow/react` (grafy sietí) |
| **Krypto & Web3** | `ethers` v6 |
| **Testovanie** | Vitest v4, Playwright v1.58, JSDOM |

---

## 🗺️ Kompletná Mapa Trás (Routing Map)

| Cesta | Účel a Popis |
| :--- | :--- |
| `/` | Úvodná obrazovka s 3D WebGL particle animáciou a rýchlym prístupom |
| `/browser` | Hlavné prostredie webového prehliadača s tabmi, Omniboxom a Copilotom |
| `/auth/login` | Prihlásenie používateľa cez WebAuthn (Passkeys / Biometria) |
| `/auth/register` | Vytvorenie a registrácia nového biometrického kľúča |
| `/forge` | Forge Studio - Vizuálny PWA vývojársky editor a Monaco editor |
| `/forza/prehlad` | Forza Dashboard - Hlavný súhrn a rýchle akcie |
| `/forza/analyza-vypisov` | Analytika bankových výpisov a finančných tokov |
| `/forza/import-csv` | Dátový import a pokročilý CSV parser |
| `/forza/osoby` | Databáza a profilovanie prešetrovaných osôb a entít |
| `/forza/siet` | Grafová vizualizácia sietí a vzťahov |
| `/forza/vztahy` | Detailný mapovač vzájomných väzieb |
| `/forza/asistent` | Špecializovaný AI asistent pre právnu a forenznú analýzu |
| `/forza/pripady` | Zoznam a správa otvorených vyšetrovacích prípadov |
| `/forza/pravny-kontext` | Modul právneho kontextu a judikatúry |
| `/forza/sandbox` | Izolovaný testovací priestor na overovanie dát |
| `/forza/mcp-info` | Diagnostika a stav pripojených MCP serverov |
| `/forza/predplatne` | Správa licencií a Stripe predplatného |
| `/forza/profil` | Profil vyšetrovateľa a administratívna karanténa |
| `/forza/sukromie` | Nastavenia šifrovania a ochrany súkromia |
| `/forza/vzhlad` | Prispôsobenie motívov a vizuálnych filtrov |
| `/forza/zbrane` | Špecializované forenzné utility |
| `/blog` | Integrovaný blog a oznamy o novinkách |
| `/offline` | PWA offline fallback obrazovka |

---

## 🏗️ Štruktúra Projektu

```
pandora-browser-main/
├── app/                        # Next.js 15 App Router
│   ├── auth/                   # Autentifikácia (WebAuthn)
│   ├── blog/                   # Blog a oznámenia
│   ├── browser/                # Jadro webového prehliadača
│   ├── forge/                  # Forge Studio vizuálny editor
│   ├── forza/                  # Forza Forensic Suite (18 sekcií)
│   ├── globals.css             # Tailwind v4 konfigurácia a CSS tokeny
│   └── layout.tsx              # Koreňový HTML layout a provideri
├── components/                 # React komponenty
│   ├── features/browser/       # Browser komponenty (Omnibox, Copilot, Shield, Panely)
│   ├── features/forge/         # Forge komponenty (VisualCanvas, Inspector, Export)
│   ├── malte/                  # 3D WebGL WelcomeParticles, AmbientField a dock
│   └── ui/                     # Primitíva shadcn/ui a Radix UI
├── electron/                   # Electron procesy
│   ├── main.mts                # Hlavný proces, správca okien a Ghostery adblocker
│   ├── preload.ts              # contextBridge pre bezpečné IPC volania
│   └── tsconfig.json           # TypeScript konfigurácia pre Electron
├── lib/                        # Aplikačné služby a logika
│   ├── api/                    # IPC rozhrania a externé API klienty
│   ├── forza/                  # Forenzné algoritmy, CSV parsery a timeline logika
│   ├── services/               # AI Service (Mistral), SearchService, WalletService
│   ├── storage/                # IndexedDB wrapper cez idb-keyval
│   └── store/                  # Zustand store (`browser-store.ts`)
├── docs/                       # Detailná technická dokumentácia
│   └── ARCHITECTURE.md         # Architektonická príručka a diagramy
├── public/                     # Statické assety, manifest.json a PWA ikony
├── .env.example                # Šablóna premenných prostredia
├── capacitor.config.json       # Konfigurácia pre mobilné platformy iOS & Android
├── next.config.mjs             # Next.js optimalizácia a PWA konfigurácia
├── vitest.config.ts            # Konfigurácia jednotkových testov
└── package.json                # Závislosti a npm skripty
```

---

## 📦 Inštalácia a Spustenie

### Systémové požiadavky
- **Node.js**: v20.x alebo novšia LTS verzia
- **Správca balíčkov**: `npm` alebo `pnpm`

### 1. Klonovanie a inštalácia
```bash
git clone https://github.com/yourusername/pandora-browser.git
cd pandora-browser
npm install
```

### 2. Spustenie vývojového servera (Web / PWA)
```bash
npm run dev
```
Aplikácia sa spustí na adrese [http://localhost:3000](http://localhost:3000).

### 3. Spustenie v desktopovom režime (Electron)
```bash
npm run electron:dev
```
Tento príkaz skompiluje Electron TypeScript súbory a spustí aplikáciu ako natívne desktopové okno s prístupom k systémovým API.

---

## 📜 Zoznam NPM Skriptov

| Skript | Príkaz | Účel |
| :--- | :--- | :--- |
| `dev` | `next dev` | Spustenie lokálneho Next.js vývojového servera na porte 3000 |
| `build` | `next build` | Zostavenie optimalizovanej produkčnej verzie webovej aplikácie |
| `start` | `next start` | Spustenie produkčného Next.js servera |
| `lint` | `next lint` | Kontrola kvality kódu pomocou Next.js ESLint pravidiel |
| `test` | `vitest` | Interaktívne sledovanie a spúšťanie Vitest testov |
| `test:e2e` | `playwright test` | Spustenie end-to-end testov v prehliadači cez Playwright |
| `test:e2e:ui` | `playwright test --ui` | Grafické rozhranie pre Playwright E2E testy |
| `electron:dev` | `... concurrently ...` | Súbežné spustenie Next.js a natívneho Electron okna |
| `electron:build` | `next build && electron-builder` | Vytvorenie inštalačných balíkov (.exe, .dmg, .AppImage) |
| `cap:build` | `next build && npx cap sync` | Synchronizácia webového buildu do Capacitor kontajnerov |
| `cap:android` | `... && npx cap open android` | Otvorenie Android projektu v Android Studio |
| `cap:ios` | `... && npx cap open ios` | Otvorenie iOS projektu v Xcode |

---

## ⚙️ Premenné Prostredia (.env)

Skopírujte šablónu `.env.example` do `.env.local` a vyplňte potrebné hodnoty:

```bash
cp .env.example .env.local
```

| Premenná | Predvolená hodnota | Popis |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_APP_NAME` | `"PANDORA Browser"` | Názov aplikácie zobrazovaný v hlavičke a titulkoch |
| `NEXT_PUBLIC_APP_VERSION` | `"2.0.0"` | Číslo verzie aplikácie |
| `NEXT_PUBLIC_BASE_URL` | `"http://localhost:3000"` | Základná URL adresa pre interné volania a WebAuthn |
| `NEXT_PUBLIC_RP_ID` | `"localhost"` | Relying Party ID pre WebAuthn biometriu |
| `NEXT_PUBLIC_RP_NAME` | `"PANDORA Browser"` | Relying Party Názov pre WebAuthn biometriu |
| `MISTRAL_API_KEY` | `""` | Globálny kľúč pre Mistral AI (používateľ si môže zadať vlastný priamo v UI) |
| `NEXT_PUBLIC_SUPABASE_URL` | `""` | Voliteľná URL adresa pre Supabase backend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `""` | Voliteľný anonymný verejný kľúč pre Supabase |

> [!NOTE]
> Ak nie sú nastavené premenné pre Supabase, aplikácia automaticky prejde do lokálneho mock režimu a nespadne.

---

## ⌨️ Klávesové Skratky (Shortcuts)

| Skratka (Windows / Linux) | Skratka (macOS) | Akcia |
| :--- | :--- | :--- |
| `Ctrl + T` | `Cmd + T` | Otvorenie nového tabu |
| `Ctrl + W` | `Cmd + W` | Zatvorenie aktuálneho tabu |
| `Ctrl + Shift + T` | `Cmd + Shift + T` | Znovuotvorenie naposledy zatvoreného tabu |
| `Ctrl + Tab` | `Ctrl + Tab` | Prepnutie na nasledujúci tab |
| `Ctrl + L` | `Cmd + L` | Aktivácia a označenie textu v Omniboxe |
| `Ctrl + B` | `Cmd + B` | Prepnutie zobrazenia bočného panela (Sidebar) |
| `F5` / `Ctrl + R` | `Cmd + R` | Obnovenie aktuálnej webovej stránky |

---

## 🧪 Testovanie a Kvalita Kódu

Projekt kladie maximálny dôraz na stabilitu, nulové regresie a čistotu kódu:

```bash
# Spustenie všetkých 129 jednotkových a integračných testov
npx vitest run
```

### Pokryté moduly a metriky:
- **`lib/__tests__/ai-service.test.ts`**: Overenie správneho volania Mistral AI endpointu, ošetrenie sieťových chýb a spracovanie payloadov.
- **`lib/__tests__/browser-store.test.ts`**: Testovanie manipulácie s tabmi, históriou, zatvorenými tabmi a zmenou aktívneho tabu.
- **`lib/__tests__/wallet-service.test.ts`**: Validácia krypto adries a fallback mechanizmov cien.
- **`lib/__tests__/search-service.test.ts`**: Generovanie vyhľadávacích návrhov a správanie pri IPC výpadku.
- **`lib/forza/` testy**: Validácia CSV parserov, detekcie fraudov, algoritmov Dimitri a IČO Atlasu.
- **`components/features/forge/` testy**: Interakcia s plátnom (VisualCanvas), bočnými panelmi a exportom buildu.
- **`components/malte/` testy**: Integrácia WebGL AmbientField a asistentov bez hydratačných chýb.

---

## 📄 Licencia

WTFPL - Do What The Fuck You Want To Public License
