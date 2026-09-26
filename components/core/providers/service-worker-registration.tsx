"use client"

import { useEffect, useState } from "react"
import { X, RefreshCw } from "lucide-react"
import { logger } from "@/lib/utils"

export function ServiceWorkerRegistration() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return
    }

    // Disable SW in development to prevent 404 errors (Workbox precaching)
    if (process.env.NODE_ENV === 'development') {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (let registration of registrations) {
          logger.info("Unregistering dev Service Worker", { scope: registration.scope })
          registration.unregister()
        }
      })
      return
    }

    const registerSW = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js")
        setRegistration(reg)
        logger.info("Service Worker registered", { scope: reg.scope })

        // Check for updates
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                setShowUpdateBanner(true)
                logger.info("New version available")
              }
            })
          }
        })

        // Check for updates every 24 hours
        setInterval(
          () => {
            reg.update()
          },
          24 * 60 * 60 * 1000,
        )
      } catch (error) {
        logger.error("Service Worker registration failed", error)
      }
    }

    registerSW()
  }, [])

  const handleUpdate = () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" })
    }
    window.location.reload()
  }

  if (!showUpdateBanner) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50">
      <div className="bg-black/90 backdrop-blur-xl border border-border rounded-xl p-4 flex items-center gap-3 shadow-2xl">
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Nová verzia dostupná</p>
          <p className="text-xs text-foreground/60">Klikni pre aktualizáciu aplikácie</p>
        </div>
        <button
          onClick={handleUpdate}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" />
          Update
        </button>
        <button
          onClick={() => setShowUpdateBanner(false)}
          className="p-1.5 hover:bg-foreground/10 rounded-lg transition-colors"
        >
          <X className="w-4 h-4 text-foreground/60" />
        </button>
      </div>
    </div>
  )
}
