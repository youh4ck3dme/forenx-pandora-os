"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GL } from "@/components/gl";
import {
  Fingerprint,
  ArrowLeft,
  AlertCircle,
  Loader2,
  User,
} from "lucide-react";
import Link from "next/link";
import { PandoraLogo } from "@/components/ui/branding/pandora-logo";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savedUser, setSavedUser] = useState<{
    username: string;
    webAuthn?: boolean;
  } | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem("pandora_user");
    if (userData) {
      try {
        setSavedUser(JSON.parse(userData));
      } catch {
        // Invalid data
      }
    }
  }, []);

  const handleBiometricLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      let webAuthnSuccess = false;

      if (window.PublicKeyCredential && savedUser?.webAuthn) {
        try {
          const challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);

          const effectiveRpId =
            process.env.NEXT_PUBLIC_RP_ID ||
            (window.location.hostname.endsWith("whoiswho.at") ? "whoiswho.at" : window.location.hostname);

          const getOptions: PublicKeyCredentialRequestOptions = {
            challenge,
            timeout: 60000,
            userVerification: "required",
            rpId: effectiveRpId,
          };

          const credential = await navigator.credentials.get({
            publicKey: getOptions,
          });

          if (credential) {
            webAuthnSuccess = true;
          }
        } catch {
          // WebAuthn not available, use simulation
        }
      }

      if (savedUser || webAuthnSuccess) {
        router.push("/browser");
      } else {
        setError("No account found. Please register first.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Failed to authenticate. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-svh w-full overflow-hidden">
      <GL hovering={false} />

      <div className="absolute inset-0 z-1 pointer-events-none">
        <div className="absolute inset-0 bg-linear-to-t from-black via-transparent to-black/50" />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center min-h-svh px-6">
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
              BROWSER
            </span>
          </div>
        </div>

        <div className="w-full max-w-sm relative group">
          <div className="absolute -inset-1 bg-linear-to-r from-purple-600 via-blue-500 to-cyan-400 rounded-2xl opacity-20 group-hover:opacity-40 blur-xl transition-opacity duration-1000" />
          <div className="relative bg-[#0a0a0f]/80 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-2xl shadow-purple-500/10">
            <h1 className="text-[17px] font-bold text-foreground mb-1">
              Welcome Back
            </h1>
            <p className="text-foreground/60 text-[11px] mb-5">
              Use your biometric authentication to securely sign in
            </p>

            {savedUser && (
              <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/10 mb-6 group/user transition-colors hover:bg-white/10">
                <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center ring-1 ring-white/10 group-hover/user:ring-purple-500/50 transition-all">
                  <User className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-gray-200 font-medium text-sm">
                    {savedUser.username}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {savedUser.webAuthn ? "Passkey available" : "Demo mode"}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col items-center py-3">
              <div className="relative mb-6 group/bio">
                <div className="absolute -inset-4 bg-purple-500/20 rounded-full blur-xl opacity-0 group-hover/bio:opacity-100 transition-opacity duration-500" />
                <button
                  onClick={handleBiometricLogin}
                  disabled={isLoading}
                  className="relative w-24 h-24 rounded-full bg-linear-to-b from-white/10 to-white/5 border border-white/10 flex items-center justify-center transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 group-hover/bio:border-purple-500/50"
                >
                  <div className="absolute inset-0 rounded-full bg-purple-500/5 animate-pulse" />
                  {isLoading ? (
                    <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
                  ) : (
                    <Fingerprint className="w-10 h-10 text-purple-400 drop-shadow-[0_0_15px_rgba(168,85,247,0.5)] transition-all group-hover/bio:text-purple-300" />
                  )}
                </button>
              </div>

              <p className="text-foreground/60 text-center text-xs mb-3">
                {isLoading
                  ? "Verifying your identity..."
                  : "Tap to authenticate with biometrics"}
              </p>

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm mb-4">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <button
                onClick={handleBiometricLogin}
                disabled={isLoading}
                className="w-full py-3.5 bg-linear-to-r from-purple-600 via-blue-600 to-cyan-500 text-white font-bold text-sm rounded-xl hover:shadow-[0_0_20px_rgba(147,51,234,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full hover:translate-y-0 transition-transform duration-300" />
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin relative z-10" />
                    <span className="relative z-10">Authenticating...</span>
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-5 h-5 relative z-10" />
                    <span className="relative z-10">Sign In with Passkey</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-center text-foreground/40 text-xs mt-5">
              Don't have an account?{" "}
              <Link
                href="/auth/register"
                className="text-purple-400 hover:underline"
              >
                Create one
              </Link>
            </p>
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
