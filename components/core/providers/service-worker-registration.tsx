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
    }

    void unregisterLegacyServiceWorkers()
  }, [])

  return null
}
