"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loginWithPasskey, isPasskeySupported } from "@/lib/auth/webauthn.client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PasskeyLoginProps {
  redirectTo?: string;
  onSuccess?: (redirectUrl: string) => void;
  onError?: (errorMsg: string) => void;
  className?: string;
}

export function PasskeyLogin({
  redirectTo = "/dashboard",
  onSuccess,
  onError,
  className,
}: PasskeyLoginProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supported = isPasskeySupported();

  async function handlePasskeyLogin() {
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await loginWithPasskey(redirectTo);

      if (!result.ok) {
        setErrorMessage(result.reason);
        onError?.(result.reason);
        toast.error(result.reason);
        return;
      }

      toast.success("Úspešne prihlásený cez Passkey.");
      if (onSuccess) {
        onSuccess(result.redirectUrl);
      } else {
        router.push(result.redirectUrl);
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Prihlásenie cez Passkey zlyhalo.";
      setErrorMessage(msg);
      onError?.(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!supported) {
    return null;
  }

  return (
    <div className={cn("w-full space-y-2", className)}>
      <Button
        type="button"
        variant="outline"
        onClick={handlePasskeyLogin}
        disabled={loading}
        data-testid="passkey-login-button"
        className={cn(
          "w-full h-11 relative flex items-center justify-center gap-2.5 font-semibold text-sm",
          "border border-white/20 bg-white/5 hover:bg-white/10 active:scale-[0.99] text-white",
          "transition-all duration-200 rounded-xl shadow-sm hover:border-purple-400/50 hover:shadow-purple-500/10",
        )}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
            <span>Čakám na hardvérový kľúč…</span>
          </>
        ) : (
          <>
            <KeyRound className="w-4 h-4 text-purple-400 transition-transform group-hover:scale-110" />
            <span>Prihlásiť sa cez Passkey</span>
          </>
        )}
      </Button>

      {errorMessage && (
        <div className="flex items-center gap-2 p-2.5 text-xs text-rose-300 bg-rose-950/40 border border-rose-500/20 rounded-lg animate-in fade-in duration-200">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
          <span className="leading-tight">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

export default PasskeyLogin;
