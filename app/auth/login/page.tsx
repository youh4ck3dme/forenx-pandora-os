"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { GL } from "@/components/gl";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PandoraLogo } from "@/components/ui/branding/pandora-logo";
import { getSafeRedirectTarget } from "@/lib/auth/redirect";
import { supabase } from "@/integrations/supabase/client";
import { setAuthCookies } from "@/lib/auth/cookies";

// ssr: false — AccountSignInForm uses useQueryClient() which requires
// QueryClientProvider; disabling SSR avoids prerender crash at build time.
const AccountSignInForm = dynamic(
  () => import("@/components/malte/AccountSignInForm").then((m) => ({ default: m.AccountSignInForm })),
  { ssr: false, loading: () => <div className="h-32" /> },
);

export default function LoginPage() {
  const router = useRouter();
  const [initialMode, setInitialMode] = useState<"signin" | "signup" | "reset">("signin");

  useEffect(() => {
    // Break out of iframes if opened inside a frame
    if (typeof window !== 'undefined' && window.top && window.top !== window.self) {
      window.top.location.href = window.location.href;
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const modeParam = searchParams.get("mode");
    if (modeParam === "signup" || modeParam === "reset" || modeParam === "signin") {
      setInitialMode(modeParam);
    }

    // If user already has an active Supabase session, sync cookies and redirect forward
    supabase.auth.getSession().then(async ({ data }: { data: { session: any } }) => {
      if (data?.session) {
        const bridgeOk = await setAuthCookies(data.session);
        if (bridgeOk) {
          const nextParam = searchParams.get("next");
          const next = getSafeRedirectTarget(nextParam, "/browser/") ?? "/browser/";
          router.replace(next);
        }
      }
    });
  }, [router]);

  return (
    <div className="relative h-dvh max-h-dvh w-full overflow-hidden overscroll-none select-none">
      <GL hovering={false} />

      <div className="absolute inset-0 z-1 pointer-events-none">
        <div className="absolute inset-0 bg-linear-to-t from-black via-transparent to-black/50" />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center h-dvh max-h-dvh px-6 py-safe overflow-hidden">
        <Link
          href="/"
          className="absolute top-6 left-6 flex items-center gap-2 text-foreground/60 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="relative">
            <div className="absolute inset-0 blur-xl bg-purple-500/30 rounded-full animate-pulse" />
            <PandoraLogo size={48} className="relative" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black tracking-tight text-foreground">
              PΛND0RΛ
            </span>
            <span className="text-[10px] font-mono text-purple-400 tracking-[0.2em]">
              FORENX OS
            </span>
          </div>
        </div>

        <div className="w-full max-w-sm relative group">
          <div className="absolute -inset-1 bg-linear-to-r from-purple-600 via-blue-500 to-cyan-400 rounded-2xl opacity-20 group-hover:opacity-40 blur-xl transition-opacity duration-1000" />
          <div className="relative bg-[#0a0a0f]/80 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-2xl shadow-purple-500/10">
            <h1 className="text-[17px] font-bold text-foreground mb-1">
              ForenX Cloud Účet
            </h1>
            <p className="text-foreground/60 text-[11px] mb-4">
              Prihláste sa pre prístup k vyšetrovacím prípadom a cloudovej databáze
            </p>

            <div className="pt-1">
              <AccountSignInForm
                dark={true}
                initialMode={initialMode}
                onSignedIn={() => {
                  const searchParams = typeof window !== "undefined"
                    ? new URLSearchParams(window.location.search)
                    : null;
                  const nextParam = searchParams?.get("next");
                  const next = getSafeRedirectTarget(nextParam, "/browser/") ?? "/browser/";
                  router.push(next);
                  router.refresh();
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-6 text-foreground/40 text-xs">
            <PandoraLogo size={12} />
            <span>Secured with WebAuthn</span>
          </div>
        </div>
      </div>
    </div>
  );
}

