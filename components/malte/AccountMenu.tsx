import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, LogOut, UserCog, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccountProfile } from "@/lib/hooks/useAccountProfile";
import { supabase } from "@/integrations/supabase/client";
import { POST_SIGN_OUT_ROUTE, signOutEverywhere } from "@/lib/forza/session";

/** Menu účtu v headri / sidebare — Profil, Predplatné, Odhlásiť sa. */
export function AccountMenu({ className }: { className?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useAccountProfile();
  const avatarUrl = profile.data?.avatarUrl?.trim() || "";

  async function handleSignOut() {
    try {
      const { networkSignOut } = await signOutEverywhere(supabase, queryClient);
      if (!networkSignOut) {
        toast.message("Odhlásené na tomto zariadení — sieť neodpovedala.");
      } else {
        toast.success("Boli ste odhlásený.");
      }
      router.replace(POST_SIGN_OUT_ROUTE || "/forza/prehlad");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Zlyhalo odhlásenie. Skúste to znova.",
      );
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu účtu"
          title="Menu účtu"
          className={cn(
            "flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-surface/70 text-foreground shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Avatar className="h-8 w-8">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-transparent">
              <UserRound className="h-4 w-4" aria-hidden />
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Účet</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/forza/profil" className="cursor-pointer">
            <UserCog className="mr-2 h-4 w-4" aria-hidden />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/forza/predplatne" className="cursor-pointer">
            <CreditCard className="mr-2 h-4 w-4" aria-hidden />
            Predplatné
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-risk-high focus:text-risk-high"
          onSelect={() => {
            void handleSignOut();
          }}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden />
          Odhlásiť sa
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
