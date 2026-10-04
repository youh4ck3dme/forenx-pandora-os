"use client";

import * as Popover from "@radix-ui/react-popover";
import { Shield, Lock, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface PrivacyShieldProps {
  url: string;
  isLoading?: boolean;
  children: React.ReactNode;
}

export function PrivacyShield({
  url,
  isLoading,
  children,
}: PrivacyShieldProps) {
  const isSecure = url.startsWith("https://") || url.startsWith("pandora://");
  const isInternal = url.startsWith("pandora://");

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="outline-none">{children}</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="w-80 bg-background/95 text-foreground backdrop-blur-md border border-border rounded-xl p-4 shadow-2xl z-[100] animate-in fade-in zoom-in-95 duration-200 ml-4 mt-2"
          sideOffset={5}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                  isSecure
                    ? "bg-green-500/10 text-green-500"
                    : "bg-red-500/10 text-red-500",
                )}
              >
                {isSecure ? (
                  <Lock className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  {isSecure ? "Connection is secure" : "Not secure"}
                </h3>
                <p className="text-sm text-foreground/60 mt-1">
                  {isSecure
                    ? "Your information (for example, passwords or credit card numbers) is private when it is sent to this site."
                    : "You should not enter any sensitive information on this site (for example, passwords or credit cards), because it could be stolen by attackers."}
                </p>
              </div>
            </div>

            <div className="h-px bg-border w-full" />

            <div className="space-y-2">
              <div className="flex items-center gap-3 p-2 hover:bg-foreground/5 rounded-lg cursor-pointer transition-colors">
                <Shield className="w-4 h-4 text-foreground/60" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Tracking Prevention</p>
                  <p className="text-xs text-foreground/40">
                    Standard protection is on
                  </p>
                </div>
              </div>

              {isInternal && (
                <div className="flex items-center gap-3 p-2 bg-blue-500/10 rounded-lg">
                  <Info className="w-4 h-4 text-blue-500" />
                  <p className="text-xs text-blue-400">
                    This is a secure internal browser page.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-foreground/40">
                Certificate: Valid
              </span>
              <button className="text-xs text-primary hover:underline">
                Certificate settings
              </button>
            </div>
          </div>
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
