# Príručka pre vývojárov (Development & Contributing Guidelines)

## Povinný zdroj pravdy

Pred úpravou si prečítajte [`docs/SOURCE-OF-TRUTH.md`](docs/SOURCE-OF-TRUTH.md) a [`AGENTS.md`](AGENTS.md). Tieto dokumenty definujú dátové toky, bezpečnostné invarianty, mobile/PWA správanie, ForenZX kontrakt a minimálne overenie. Zmena kontraktu musí aktualizovať dokumentáciu a relevantné testy.

## Štruktúra projektu (Project Structure)

Projekt využíva modulárnu architektúru rozdelenú podľa domén:

- `app/`: Next.js 15 App Router stránky, layouty a API handlery.
- `components/features/{featureName}`: Špecifická logika funkcií (napr. `browser`, `forge`).
- `components/malte/`: 3D WebGL particle animácie (`WelcomeParticles`), ambientné vrstvy a dokovacia navigácia.
- `components/ui/`: Zdieľané Radix UI / shadcn komponenty.
- `lib/`: Aplikačná logika organizovaná do modulov:
  - `api/`: Electron IPC a externé API rozhrania.
  - `store/`: Zustand globálny state (`browser-store.ts`).
  - `storage/`: Vrstva perzistencie (LocalStorage & IndexedDB cez `idb-keyval`).
  - `services/`: Biznis logika (Mistral `ai-service`, `search-service`, `wallet-service`).
  - `forza/`: Forenzná analýza, parsovanie CSV dát a reporting.
  - `utils/`: Zdieľané pomocné funkcie.
- `electron/`: Hlavný proces Electronu (`main.mts`), `preload.ts` a IPC mostíky.
- `docs/`: Architektúra a podrobná systémová dokumentácia.

## Príprava a Spustenie (Getting Started)

1. **Inštalácia závislostí**:
   ```bash
   npm install
   # alebo
   pnpm install
   ```

2. **Spustenie vývojového servera (Web / PWA)**:
   ```bash
   npm run dev
   ```
   Aplikácia beží na [http://localhost:3000](http://localhost:3000).

3. **Spustenie v desktopovom režime (Electron)**:
   ```bash
   npm run electron:dev
   ```

4. **Spustenie testov**:
   ```bash
   # Vitest unit a integration testy (129 testov)
   npx vitest run

   # Playwright E2E testy
   npm run test:e2e
   ```

## Správa stavu (State Management)
Používame **Zustand** v kombinácii s **IndexedDB** pre perzistentné ukladanie histórie, tabov a záložiek. Hlavný store sa nachádza v `lib/store/browser-store.ts`.

## Štýly a UI
- **Tailwind CSS v4** s definíciou CSS premenných v `@layer base`.
- Žiadne inline neštruktúrované štýly – používajte Tailwind triedy a utilitné pomocníky `cn()`.

## Záväzky a Konvencie (Commits)
Dodržujte konvenciu Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
