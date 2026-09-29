"use client";

import { useEffect } from "react";
import { getSupabaseSessionToken } from "@/lib/forza/access-audit";

/**
 * P0-04 — frontend error reporting.
 *
 * window.onerror a unhandledrejection sa posielajú do POST /api/health/observe
 * (štruktúrovaný sink so sanitizáciou PII/API kľúčov na serveri). Best-effort:
 * hlásenie nikdy nesmie spôsobiť ďalšiu chybu ani blokovať UI.
 */
export function reportClientError(payload: {
  message: string;
  stack?: string;
  route?: string;
  severity?: "error" | "warning";
}): void {
  void (async () => {
    try {
      const token = await getSupabaseSessionToken();
      // Anonymous users have no session token. /api/health/observe requires
      // an authenticated administrator session. Never send unauthenticated requests.
      if (!token || !token.trim()) {
        return;
      }

      await fetch("/api/health/observe", {
        method: "POST",
        keepalive: true,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: payload.message.slice(0, 2000),
          stack: payload.stack?.slice(0, 8000),
          route: payload.route?.slice(0, 500),
          severity: payload.severity ?? "error",
        }),
      });
    } catch {
      // Best-effort: chyba reporting nikdy nespustí rekurziu chýb.
    }
  })();
}

export function ObservabilityReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError({
        message: event.message || "Neznáma chyba klienta",
        stack: event.error instanceof Error ? event.error.stack : undefined,
        route: window.location.pathname,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? `${event.reason.name}: ${event.reason.message}`
          : String(event.reason ?? "Neznáme odmietnutie Promise");
      reportClientError({
        message: `Unhandled rejection: ${reason}`,
        route: window.location.pathname,
        severity: "warning",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
