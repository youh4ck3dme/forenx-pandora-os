import { useBrowserStore } from "@/lib/store";
// import { GL } from '@/components/gl' // Removed static import
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { isElectron } from "@/lib/api";

import React, { memo } from "react";

const Globe = dynamic(() => import("@/components/ui/Globe").then((mod) => mod.Globe), {
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

    const isNewTab = tab.url === "pandora://newtab" || tab.url.startsWith("pandora://");
    const isInternalApp = tab.url.includes("/forza/");
    const shouldRenderIframe = isInternalApp || (!isElectronEnv && !isNewTab);

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
            {isActive && <Globe hovering={hovering} />}
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
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              onLoad={() => {
                updateTab(tab.id, { isLoading: false });
              }}
              onError={(e) => {
                console.error("Iframe load error", e);
                updateTab(tab.id, { isLoading: false });
              }}
            />
            {!tab.url.includes("localhost") &&
              !tab.url.includes("127.0.0.1") &&
              !isInternalApp &&
              !tab.url.startsWith("/") &&
              !tab.url.startsWith("pandora://") && (
                <div className="absolute bottom-4 right-4 bg-black/80 text-white p-2 rounded-lg text-xs pointer-events-none opacity-50 hover:opacity-100 transition-opacity z-20">
                  If site fails to load, it might be blocked by security policy.
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
