"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, RotateCcw, Save, Undo2, Upload } from "lucide-react";

import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/malte/ColorPicker";
import { BRAND } from "@/config/brand";
import {
  DEFAULT_THEME,
  TOKEN_SPECS,
  applyTokens,
  auditContrast,
  exportTheme,
  importTheme,
  isDefaultTheme,
  loadStoredTheme,
  saveTheme,
  validateToken,
  type ThemeTokens,
  type TokenSpec,
} from "@/lib/forza/theme-tokens";

export default function VzhladPage() {
  return <ThemeEditorScreen />;
}

const GROUPS = Array.from(new Set(TOKEN_SPECS.map((spec) => spec.group)));

function ThemeEditorScreen() {
  const [saved, setSaved] = useState<ThemeTokens>(DEFAULT_THEME);
  const [draft, setDraft] = useState<ThemeTokens>(DEFAULT_THEME);
  const [openGroup, setOpenGroup] = useState<string>(GROUPS[0] ?? "");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const stored = loadStoredTheme();
    setSaved(stored);
    setDraft(stored);
    applyTokens(stored);
  }, []);

  useEffect(() => {
    applyTokens(draft);
  }, [draft]);

  const dirty = useMemo(
    () => TOKEN_SPECS.some((spec) => draft[spec.key] !== saved[spec.key]),
    [draft, saved],
  );

  const issues = useMemo(() => auditContrast(draft), [draft]);

  const setToken = useCallback((key: string, value: string) => {
    setDraft((prev) => {
      const valid = validateToken(key, value);
      if (valid === null) return prev;
      return { ...prev, [key]: valid };
    });
  }, []);

  function handleSave() {
    saveTheme(draft);
    setSaved(draft);
    toast.success("Téma uložená do tohto zariadenia.");
  }

  function handleCancel() {
    setDraft(saved);
    applyTokens(saved);
    toast.info("Zmeny zrušené, platí posledná uložená téma.");
  }

  function handleResetAll() {
    setDraft({ ...DEFAULT_THEME });
    toast.info("Obnovená predvolená téma WHITE / FROSTED GREY (neuložené).");
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(exportTheme(draft), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "forenx-tema.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const result = importTheme(text);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft(result.tokens);
      if (result.rejected.length > 0) {
        toast.warning(
          `Načítané. Nepovolené položky boli vynechané: ${result.rejected.join(", ")}`,
        );
      } else {
        toast.success("Téma načítaná. Skontrolujte náhľad a uložte.");
      }
    } catch {
      toast.error("Súbor sa nepodarilo prečítať.");
    }
  }

  return (
    <PhoneFrame>
      <AppHeader title="Vzhľad a téma" />
      <Screen>
        <SectionTitle>Živý náhľad</SectionTitle>
        <Card className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Zmeny vidíte okamžite v celej aplikácii. Trvalo sa uložia až po
            stlačení „Uložiť“.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={!dirty}>
              <Save className="mr-2 h-4 w-4" aria-hidden />
              Uložiť
            </Button>
            <Button variant="outline" onClick={handleCancel} disabled={!dirty}>
              <Undo2 className="mr-2 h-4 w-4" aria-hidden />
              Zrušiť zmeny
            </Button>
            <Button
              variant="outline"
              onClick={handleResetAll}
              disabled={isDefaultTheme(draft)}
            >
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              Reset celej témy
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              Export JSON
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" aria-hidden />
              Import JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleImport(file);
              }}
            />
          </div>
        </Card>

        {issues.length > 0 ? (
          <Card className="space-y-2 border-destructive/40">
            <p className="text-[13px] font-semibold text-destructive">
              Slabý kontrast ({issues.length})
            </p>
            <ul className="space-y-2 text-[12px] text-muted-foreground">
              {issues.map((issue) => (
                <li
                  key={`${issue.tokenKey}-${issue.label}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {issue.label}: {issue.ratio.toFixed(2)} : 1 (minimum 4.5 :
                    1)
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setToken(issue.tokenKey, issue.suggestion)}
                  >
                    Opraviť
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card className="text-[12px] text-muted-foreground">
            Kontrast textu voči výsledným povrchom vyhovuje (min. 4.5 : 1).
          </Card>
        )}

        {GROUPS.map((group) => {
          const specs = TOKEN_SPECS.filter((spec) => spec.group === group);
          const open = openGroup === group;
          return (
            <div key={group}>
              <SectionTitle>
                <button
                  type="button"
                  className="w-full text-left"
                  aria-expanded={open}
                  onClick={() => setOpenGroup(open ? "" : group)}
                >
                  {group} {open ? "▾" : "▸"}
                </button>
              </SectionTitle>
              {open ? (
                <Card className="space-y-6">
                  {specs.map((spec) => (
                    <TokenField
                      key={spec.key}
                      spec={spec}
                      value={draft[spec.key] ?? DEFAULT_THEME[spec.key] ?? ""}
                      onChange={(next) => setToken(spec.key, next)}
                      onReset={() =>
                        setToken(spec.key, DEFAULT_THEME[spec.key] ?? "")
                      }
                      isDefault={draft[spec.key] === DEFAULT_THEME[spec.key]}
                    />
                  ))}
                </Card>
              ) : null}
            </div>
          );
        })}
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}

function TokenField({
  spec,
  value,
  onChange,
  onReset,
  isDefault,
}: {
  spec: TokenSpec;
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  isDefault: boolean;
}) {
  const unit = spec.unit ?? "";
  const numeric = Number.parseFloat(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">
          {spec.label}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {value}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            disabled={isDefault}
            aria-label={`Obnoviť predvolenú hodnotu: ${spec.label}`}
          >
            Reset
          </Button>
        </div>
      </div>
      {spec.kind === "color" ? (
        <ColorPicker label={spec.label} value={value} onChange={onChange} />
      ) : (
        <input
          type="range"
          aria-label={spec.label}
          min={spec.min ?? 0}
          max={spec.max ?? 1}
          step={spec.step ?? 0.01}
          value={Number.isFinite(numeric) ? numeric : (spec.min ?? 0)}
          onChange={(event) => onChange(`${event.target.value}${unit}`)}
          className="h-10 w-full cursor-pointer"
        />
      )}
    </div>
  );
}
