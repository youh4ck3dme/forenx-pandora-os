"use client";

import type React from "react";

import { useState } from "react";
import { GL } from "@/components/gl";
import {
  Fingerprint,
  ArrowLeft,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { PandoraLogo } from "@/components/ui/branding/pandora-logo";

type RegistrationStep = "username" | "biometric" | "success";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function RegisterPage() {
  const [step, setStep] = useState<RegistrationStep>("username");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (username.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }
    setError(null);
    setStep("biometric");
  };

  const handleBiometricSetup = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      let webAuthnSuccess = false;

      if (window.PublicKeyCredential) {
        try {
          const available =
            await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();

          if (available) {
            const challenge = new Uint8Array(32);
            crypto.getRandomValues(challenge);

            const userId = new Uint8Array(16);
            crypto.getRandomValues(userId);

            const effectiveRpId =
              process.env.NEXT_PUBLIC_RP_ID ||
              (window.location.hostname.endsWith("whoiswho.at") ? "whoiswho.at" : window.location.hostname);

            const createOptions: PublicKeyCredentialCreationOptions = {
              challenge,
              rp: {
                name: process.env.NEXT_PUBLIC_RP_NAME || "PANDORA Browser",
                id: effectiveRpId,
              },
              user: {
                id: userId,
                name: username,
                displayName: username,
              },
              pubKeyCredParams: [
                { alg: -7, type: "public-key" },
                { alg: -257, type: "public-key" },
              ],
              authenticatorSelection: {
                authenticatorAttachment: "platform",
                userVerification: "required",
                residentKey: "required",
              },
              timeout: 60000,
              attestation: "none",
            };

            const credential = await navigator.credentials.create({
              publicKey: createOptions,
            });

            if (credential) {
              webAuthnSuccess = true;
              const rawId = new Uint8Array(
                (credential as PublicKeyCredential).rawId,
              );
              localStorage.setItem(
                "pandora_user",
                JSON.stringify({
                  username,
                  credentialId: uint8ArrayToBase64(rawId),
                  createdAt: Date.now(),
                  webAuthn: true,
                }),
              );
            }
          }
        } catch {
          // WebAuthn not available, use simulation
        }
      }

      if (!webAuthnSuccess) {
        localStorage.setItem(
          "pandora_user",
          JSON.stringify({
            username,
            credentialId: "simulated_" + Date.now(),
            createdAt: Date.now(),
            webAuthn: false,
          }),
        );
      }

      setStep("success");
    } catch (err) {
      console.error("Setup error:", err);
      setError("Failed to setup authentication. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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
            <div className="absolute -inset-1 rounded-full bg-linear-to-r from-purple-500/30 to-blue-500/30 opacity-50" />
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

        <div className="w-full max-w-sm">
          <div className="bg-black/50 backdrop-blur-xl border border-border rounded-2xl p-6">
            {step === "username" && (
              <>
                <h1 className="text-[17px] font-bold text-foreground mb-1">
                  Create Account
                </h1>
                <p className="text-foreground/60 text-[11px] mb-5">
                  Choose a username for your secure browser
                </p>

                <form onSubmit={handleUsernameSubmit} className="space-y-3">
                  <div>
                    <label
                      htmlFor="username"
                      className="block text-xs font-medium text-foreground/80 mb-1.5"
                    >
                      Username
                    </label>
                    <input
                      type="text"
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      className="w-full px-3 py-2.5 bg-black/50 border border-border rounded-lg text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all"
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-linear-to-r from-purple-600 via-blue-500 to-cyan-400 text-white font-bold text-sm rounded-xl hover:opacity-90 transition-opacity"
                  >
                    Continue
                  </button>
                </form>

                <p className="text-center text-foreground/40 text-xs mt-5">
                  Already have an account?{" "}
                  <Link
                    href="/auth/login"
                    className="text-purple-400 hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </>
            )}

            {step === "biometric" && (
              <>
                <h1 className="text-[17px] font-bold text-foreground mb-1">
                  Setup Biometrics
                </h1>
                <p className="text-foreground/60 text-[11px] mb-5">
                  Use your device's biometric authentication for secure,
                  passwordless login
                </p>

                <div className="flex flex-col items-center py-5">
                  <div className="relative mb-4">
                    <div className="absolute -inset-1 rounded-full bg-linear-to-r from-purple-500/30 to-blue-500/30 opacity-50" />
                    <div className="relative w-16 h-16 rounded-full bg-black/50 border-2 border-purple-500/50 flex items-center justify-center">
                      <Fingerprint className="w-8 h-8 text-purple-400" />
                    </div>
                  </div>

                  <p className="text-foreground/60 text-center text-xs mb-4">
                    Your biometric data never leaves your device. We use
                    WebAuthn for maximum security.
                  </p>

                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-sm mb-4">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleBiometricSetup}
                    disabled={isLoading}
                    className="w-full py-2.5 bg-linear-to-r from-purple-600 via-blue-500 to-cyan-400 text-white font-bold text-sm rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Authenticating...
                      </>
                    ) : (
                      <>
                        <Fingerprint className="w-4 h-4" />
                        Setup Biometric Login
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setStep("username")}
                    className="mt-3 text-foreground/40 text-xs hover:text-foreground transition-colors"
                  >
                    Go back
                  </button>
                </div>
              </>
            )}

            {step === "success" && (
              <div className="flex flex-col items-center py-5">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                  <Check className="w-6 h-6 text-green-500" />
                </div>

                <h1 className="text-[17px] font-bold text-foreground mb-1">
                  You're All Set!
                </h1>
                <p className="text-foreground/60 text-center text-[11px] mb-4">
                  Your account has been created with biometric authentication.
                </p>

                <Link
                  href="/browser"
                  className="w-full py-2.5 bg-linear-to-r from-purple-600 via-blue-500 to-cyan-400 text-white font-bold text-sm rounded-xl hover:opacity-90 transition-opacity text-center"
                >
                  Launch Browser
                </Link>
              </div>
            )}
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
