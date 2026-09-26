import { useCallback, useEffect, useRef, useState } from "react";

import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "@/lib/theme-tokens";

type Props = {
  value: string;
  label: string;
  onChange: (hex: string) => void;
  /** Volá sa až po pustení prsta — vtedy sa hodnota považuje za potvrdenú v náhľade. */
  onCommit?: (hex: string) => void;
};

/**
 * Plynulý dotykový picker: saturačno-jasová plocha + hue posuvník + HEX vstup.
 * Výber nie je obmedzený na prednastavené palety.
 */
export function ColorPicker({ value, label, onChange, onCommit }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(value);
  const planeRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    setHexDraft(value);
    setHsv((prev) => {
      const next = hexToHsv(value);
      // Hue si držíme, aby sa pri čiernej/bielej nepreskakoval odtieň.
      return { ...next, h: next.s === 0 ? prev.h : next.h };
    });
  }, [value]);

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      setHexDraft(hex);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        onChange(hex);
      });
    },
    [onChange],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function handlePlanePointer(event: React.PointerEvent<HTMLDivElement>) {
    const node = planeRef.current;
    if (!node) return;
    if (event.type === "pointerdown") node.setPointerCapture(event.pointerId);
    else if (!node.hasPointerCapture(event.pointerId)) return;
    const rect = node.getBoundingClientRect();
    const x = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.min(
      1,
      Math.max(0, (event.clientY - rect.top) / rect.height),
    );
    emit({ h: hsv.h, s: x, v: 1 - y });
  }

  function commit() {
    onCommit?.(hsvToHex(hsv));
  }

  function nudge(deltaS: number, deltaV: number) {
    emit({
      h: hsv.h,
      s: Math.min(1, Math.max(0, hsv.s + deltaS)),
      v: Math.min(1, Math.max(0, hsv.v + deltaV)),
    });
  }

  return (
    <div className="space-y-3">
      <div
        ref={planeRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label} — sýtosť a jas`}
        aria-valuetext={`${Math.round(hsv.s * 100)} % sýtosť, ${Math.round(hsv.v * 100)} % jas`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        onPointerDown={handlePlanePointer}
        onPointerMove={handlePlanePointer}
        onPointerUp={commit}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          if (event.key === "ArrowRight") nudge(step, 0);
          else if (event.key === "ArrowLeft") nudge(-step, 0);
          else if (event.key === "ArrowUp") nudge(0, step);
          else if (event.key === "ArrowDown") nudge(0, -step);
          else return;
          event.preventDefault();
          commit();
        }}
        className="relative h-40 w-full touch-none rounded-[var(--forenx-control-radius)] border border-border"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-card"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: hsvToHex(hsv),
          }}
        />
      </div>

      <label className="block">
        <span className="sr-only">{`${label} — odtieň`}</span>
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={Math.round(hsv.h)}
          onChange={(event) => emit({ ...hsv, h: Number(event.target.value) })}
          onPointerUp={commit}
          onKeyUp={commit}
          className="h-10 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background:
              "linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)",
          }}
        />
      </label>

      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-9 w-9 shrink-0 rounded-[var(--forenx-control-radius)] border border-border"
          style={{ backgroundColor: value }}
        />
        <input
          aria-label={`${label} — HEX`}
          value={hexDraft}
          spellCheck={false}
          onChange={(event) => {
            const raw = event.target.value;
            setHexDraft(raw);
            const hex = normalizeHex(raw);
            if (hex) {
              setHsv(hexToHsv(hex));
              onChange(hex);
            }
          }}
          onBlur={() => {
            const hex = normalizeHex(hexDraft);
            if (!hex) setHexDraft(value);
            else onCommit?.(hex);
          }}
          className="forenx-input font-mono"
        />
      </div>
    </div>
  );
}
