"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const CONSENT_STORAGE_KEY = "forenx.analytics-consent.v1";
const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";
const analyticsEnabled =
  process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "true" &&
  /^G-[A-Z0-9]+$/.test(measurementId);
const PUBLIC_ANALYTICS_PATHS = new Set([
  "/",
  "/pricing",
  "/auth/login",
  "/auth/register",
  "/auth/signup",
]);

type ConsentChoice = "accepted" | "rejected";
type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: Gtag;
  }
}

function saveConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // A private browsing policy may disable storage; keep the choice in memory.
  }
}

function initializeAnalytics(): void {
  if (typeof window.gtag === "function") {
    window.gtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    return;
  }

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };

  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("consent", "update", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement("script");
  script.id = "forenx-google-analytics";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

function recordPublicPageView(pathname: string): void {
  if (!PUBLIC_ANALYTICS_PATHS.has(pathname) || typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", "page_view", {
    page_path: pathname,
    page_location: `${window.location.origin}${pathname}`,
    page_title: "ForenX",
  });
}

export function GoogleAnalyticsConsent() {
  const pathname = usePathname() ?? "/";
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!analyticsEnabled) return;

    try {
      const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      if (stored === "accepted" || stored === "rejected") {
        setChoice(stored);
      }
    } catch {
      // Show the consent choice if browser storage is unavailable.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!analyticsEnabled || !ready) return;

    if (choice === "accepted") {
      initializeAnalytics();
      recordPublicPageView(pathname);
    } else if (choice === "rejected" && typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    }
  }, [choice, pathname, ready]);

  if (!analyticsEnabled || !ready) return null;

  if (choice === null) {
    return (
      <section
        aria-label="Nastavenie analytických cookies"
        className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-xl rounded-xl border bg-background p-4 text-foreground shadow-xl sm:inset-x-auto sm:left-4"
      >
        <p className="text-sm">
          Analytické cookies nám pomáhajú zlepšovať verejné stránky. Analytiku
          načítame iba po vašom súhlase a neposielame názvy stránok prípadov,
          obsah vyšetrovania ani identifikátory používateľa.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => {
              saveConsent("accepted");
              setChoice("accepted");
            }}
            type="button"
          >
            Povoliť analytiku
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm font-medium"
            onClick={() => {
              saveConsent("rejected");
              setChoice("rejected");
            }}
            type="button"
          >
            Odmietnuť
          </button>
        </div>
      </section>
    );
  }

  return (
    <button
      aria-label="Zmeniť nastavenie analytických cookies"
      className="fixed bottom-3 left-3 z-[100] rounded-full border bg-background px-3 py-2 text-xs text-foreground shadow-lg"
      onClick={() => setChoice(null)}
      type="button"
    >
      Súkromie
    </button>
  );
}
