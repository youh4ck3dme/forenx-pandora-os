import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Crosshair, Receipt, Search, User } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navGroups, navItems } from "@/components/malte/nav";
import { formatEur } from "@/lib/forza/forensic";
import { useActiveCase } from "@/lib/hooks/useActiveCase";

const OPEN_EVENT = "malte:command-open";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="flex w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Search className="h-3.5 w-3.5" aria-hidden />
      Hľadať v prípade…
      <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px]">
        ⌘K
      </kbd>
    </button>
  );
}

export function CommandPalette() {
  const { activeCase } = useActiveCase();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v: boolean) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const go = (to: string) => {
    setOpen(false);
    router.push(to);
  };

  // Jeden zoznam obrazoviek bez opakovaných položiek.
  const screenTargets = Array.from(
    new Map(
      [...navItems, ...navGroups.flatMap((group) => group.items)].map(
        (item) => [item.to, item],
      ),
    ).values(),
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Hľadať subjekt, transakciu, zbraň…" />
      <CommandList>
        <CommandEmpty>Nič sa nenašlo.</CommandEmpty>

        <CommandGroup heading="Obrazovky">
          {screenTargets.map(({ to, label, icon: Icon }) => (
            <CommandItem
              key={to}
              value={`obrazovka ${label}`}
              onSelect={() => go(to)}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Subjekty">
          {activeCase.entities.map((e: { id: string; name: string; role: string; kind: string }) => (
            <CommandItem
              key={e.id}
              value={`${e.name} ${e.role}`}
              onSelect={() => go("/osoby")}
            >
              {e.kind === "person" ? (
                <User className="h-4 w-4" aria-hidden />
              ) : (
                <Building2 className="h-4 w-4" aria-hidden />
              )}
              <span>{e.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {e.role}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Transakcie">
          {activeCase.transactions.slice(0, 12).map((t: { id: string; description: string; amount: number }) => (
            <CommandItem
              key={t.id}
              value={`${t.description} ${t.id}`}
              onSelect={() => go("/analyza-vypisov")}
            >
              <Receipt className="h-4 w-4" aria-hidden />
              <span className="truncate">{t.description}</span>
              <span className="ml-auto text-[10px] tnum text-muted-foreground">
                {formatEur(t.amount)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Dôkazy a Spis Armivex">
          <CommandItem
            value="Glock 19 Gen 5 CGDV051 Europol Španielsko LR 1000000"
            onSelect={() => go("/asistent")}
          >
            <Crosshair className="h-4 w-4 text-rose-500" aria-hidden />
            <span>Glock 19 Gen 5 (v.č. CGDV051)</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Europol Španielsko (Dôkaz 01)
            </span>
          </CommandItem>
          <CommandItem
            value="Grand Power K100 K055902 K055904 KEÚ PZ"
            onSelect={() => go("/asistent")}
          >
            <Crosshair className="h-4 w-4 text-amber-500" aria-hidden />
            <span>Grand Power K100 (v.č. K055902, K055904)</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Balistika KEÚ PZ (Dôkaz 02)
            </span>
          </CommandItem>
          <CommandItem
            value="Kniha zbraní LA 002318 stratená písmoznalectvo 142 TP"
            onSelect={() => go("/asistent")}
          >
            <Receipt className="h-4 w-4 text-rose-400" aria-hidden />
            <span>Kniha LA 002318 (Procesná mína)</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Chýba písmoznalectvo (§ 142 TP)
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Zbrane">
          {activeCase.weapons.map((w: { id: string; brand: string; model: string; serial: string }) => (
            <CommandItem
              key={w.id}
              value={`${w.brand} ${w.model} ${w.serial}`}
              onSelect={() => go("/zbrane")}
            >
              <Crosshair className="h-4 w-4" aria-hidden />
              <span>
                {w.brand} {w.model}
              </span>
              <span className="ml-auto text-[10px] tnum text-muted-foreground">
                {w.serial}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
