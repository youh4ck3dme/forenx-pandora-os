import { useBrowserStore } from "@/lib/store";
// import { GL } from '@/components/gl' // Removed static import
import dynamic from "next/dynamic";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { isElectron } from "@/lib/api";

import React, { memo } from "react";

const GL = dynamic(() => import("@/components/gl").then((mod) => mod.GL), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-black" />,
});

// Memoized Tab Content Component
// Prevents re-renders of the iframe/content if props rely on deep equality or primitives
const TabContent = memo(
  function TabContent({
    tab,
    isActive,
    isElectronEnv,
    updateTab,
  }: {
    tab: any;
    isActive: boolean;
    isElectronEnv: boolean;
    updateTab: (id: string, data: any) => void;
  }) {
    const [hovering, setHovering] = useState(false);
    const [loadTimedOut, setLoadTimedOut] = useState(false);
    const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearLoadTimeout = () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };

    // A site that has not fired onLoad within the timeout is treated as failed to embed
    useEffect(() => {
      setLoadTimedOut(false);
      loadTimeoutRef.current = setTimeout(() => {
        setLoadTimedOut(true);
      }, 8000);
      return clearLoadTimeout;
    }, [tab.url]);

    const isNewTab = tab.url === "pandora://newtab" || tab.url.startsWith("pandora://");

    // Single Shell Architecture & URL Normalization:
    // Determine if URL is strictly same-origin (never trust external origin just because it includes '/forza/')
    let isInternalApp = false;
    let isNestedShell = false;
    let isAuthLogin = false;

    if (!isNewTab && typeof window !== "undefined") {
      try {
        const origin = window.location.origin;
        const parsed = new URL(tab.url, origin);
        const isSameOrigin = parsed.origin === origin;

        if (isSameOrigin) {
          isInternalApp = true;
          const pathname = parsed.pathname;
          // Prevent nested shell if tab navigates to '/' or '/browser'
          if (pathname === "/" || pathname === "/browser" || pathname.startsWith("/browser/")) {
            isNestedShell = true;
          }
          if (pathname === "/auth/login" || pathname.startsWith("/auth/")) {
            isAuthLogin = true;
          }
        }
      } catch {
        isInternalApp = false;
      }
    }

    // If an embedded tab attempted to navigate to login (e.g. session expired),
    // escape iframe and transfer auth flow to top-level window with return path
    useEffect(() => {
      if (isAuthLogin && typeof window !== "undefined" && window.top) {
        window.top.location.href = tab.url;
      }
    }, [isAuthLogin, tab.url]);

    // If a tab attempted to load the browser shell itself, redirect it to the forensic overview
    useEffect(() => {
      if (isNestedShell) {
        updateTab(tab.id, {
          url: "/forza/prehlad",
          title: "Forenzný prehľad",
          isLoading: false,
        });
      }
    }, [isNestedShell, tab.id, updateTab]);

    const shouldRenderIframe = (isInternalApp || (!isElectronEnv && !isNewTab)) && !isNestedShell && !isAuthLogin;

    return (
      <div
        className={cn(
          "absolute inset-0 w-full h-full bg-background",
          !isActive && "hidden",
        )}
      >
        {/* 3D Background / Clean Welcome Animation (pure animation for empty/new tabs) */}
        {isNewTab && (
          <div
            className="w-full h-full relative bg-black overflow-hidden flex items-center justify-center select-none"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
          >
            {isActive && <GL hovering={hovering} />}
          </div>
        )}

        {/* Web Content (Iframe for internal forensic apps and web-mode websites) */}
        {shouldRenderIframe && (
          <>
            {tab.isLoading && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
            <iframe
              src={tab.url}
              className="w-full h-full border-none"
              sandbox={
                isInternalApp
                  ? undefined
                  : "allow-scripts allow-forms allow-popups allow-modals allow-downloads"
              }
              onLoad={(e) => {
                clearLoadTimeout();
                setLoadTimedOut(false);
                updateTab(tab.id, { isLoading: false });

                // Inspect same-origin iframe location for auth redirect
                try {
                  const iframeLoc = (e.target as HTMLIFrameElement)?.contentWindow?.location;
                  if (iframeLoc && iframeLoc.pathname.startsWith("/auth/")) {
                    if (window.top) {
                      window.top.location.href = iframeLoc.href;
                    }
                  }
                } catch {
                  // Cross-origin iframe, ignore
                }
              }}
              onError={(e) => {
                console.error("Iframe load error", e);
                clearLoadTimeout();
                setLoadTimedOut(true);
                updateTab(tab.id, { isLoading: false });
              }}
            />
            {loadTimedOut &&
              !isInternalApp &&
              !tab.url.startsWith("pandora://") && (
                <div className="absolute bottom-4 right-4 bg-black/80 text-white p-2 rounded-lg text-xs pointer-events-none z-20 max-w-xs">
                  This site may refuse to load inside an embedded frame
                  (X-Frame-Options / CSP frame-ancestors). Open it in the
                  desktop app or a new tab instead.
                </div>
              )}
          </>
        )}
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison for performance
    return (
      prev.isActive === next.isActive &&
      prev.isElectronEnv === next.isElectronEnv &&
      prev.tab.id === next.tab.id &&
      prev.tab.url === next.tab.url &&
      prev.tab.isLoading === next.tab.isLoading &&
      prev.tab.title === next.tab.title
    );
  },
);

export function WebView() {
  const tabs = useBrowserStore((s) => s.tabs);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const updateTab = useBrowserStore((s) => s.updateTab);

  const [isElectronEnv, setIsElectronEnv] = useState(false);

  useEffect(() => {
    setIsElectronEnv(isElectron());
  }, []);

  const activeTabIndex = tabs.findIndex(
    (t: { id: string }) => t.id === activeTabId,
  );

  return (
    <div className="w-full h-full relative bg-white">
      {tabs.map(
        (
          tab: { id: string; url: string; title?: string; isLoading?: boolean },
          index: number,
        ) => {
          const isActive = tab.id === activeTabId;
          const distance = Math.abs(index - activeTabIndex);
          const shouldRender = isElectronEnv
            ? isActive || tab.url === "pandora://newtab"
            : distance <= 1 || tab.url === "pandora://newtab";

          if (!shouldRender) return null;

          return (
            <TabContent
              key={tab.id}
              tab={tab}
              isActive={isActive}
              isElectronEnv={isElectronEnv}
              updateTab={updateTab}
            />
          );
        },
      )}
    </div>
  );
}
