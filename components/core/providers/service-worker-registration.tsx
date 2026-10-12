"use client"

import { useEffect } from "react"
import { logger } from "@/lib/utils"

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return
    }

    const unregisterLegacyServiceWorkers = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(
          registrations.map(async (registration) => {
            const removed = await registration.unregister()
            if (removed) {
              logger.info("Unregistered legacy Service Worker", {
                scope: registration.scope,
              })
            }
          }),
        )
      } catch (error) {
        logger.error("Legacy Service Worker cleanup failed", error)
      }
      // Starý Workbox worker mohol nechať cache (aj /api odpovede). Po odregistrovaní
      // ich nič nepoužíva, ale ostali by na disku. Cache Storage je per-origin, takže
      // sa mažú iba cache tohto originu; aplikácia Cache Storage inak nepoužíva
      // (rovnako ich maže odhlásenie v lib/forza/session.ts).
      try {
        if ("caches" in window) {
          const keys = await window.caches.keys()
          await Promise.all(keys.map((key) => window.caches.delete(key)))
        }
      } catch (error) {
        logger.error("Legacy cache cleanup failed", error)
      }
    }

    void unregisterLegacyServiceWorkers()
  }, [])

  return null
}
