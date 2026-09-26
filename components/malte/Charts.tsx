import { useState } from "react";

export function DonutChart({
  incomeRatio = 0.62,
  size = 116,
  caption,
}: {
  incomeRatio?: number;
  size?: number;
  caption?: string;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Pomer bezhotovostných a hotovostných platieb"
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--expense)"
            strokeWidth={stroke}
            opacity={0.85}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--income)"
            strokeWidth={stroke}
            strokeDasharray={`${c * incomeRatio} ${c}`}
            strokeLinecap="round"
            style={{
              transition: "stroke-dasharray 700ms var(--ease-out-soft)",
            }}
          />
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-metric">{Math.round(incomeRatio * 100)} %</span>
        <span className="text-[9px] text-muted-foreground">
          {caption ?? "bezhotovostne"}
        </span>
      </div>
    </div>
  );
}

export function BalanceChart({
  data,
  labels,
  format = (v: number) => String(Math.round(v)),
}: {
  data: number[];
  labels?: string[];
  format?: (value: number) => string;
}) {
  const w = 320;
  const h = 130;
  const padY = 12;
  const [hover, setHover] = useState<number | null>(null);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - padY * 2) - padY;
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const active = hover === null ? null : pts[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-36 w-full touch-none"
        preserveAspectRatio="none"
        role="img"
        aria-label="Kumulatívny vývoj objemu"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          setHover(
            Math.max(
              0,
              Math.min(data.length - 1, Math.round(ratio * (data.length - 1))),
            ),
          );
        }}
      >
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1="0"
            x2={w}
            y1={Math.max(0.5, h * g)}
            y2={Math.max(0.5, h * g)}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
        ))}
        <path d={area} fill="url(#balanceFill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {active ? (
          <g>
            <line
              x1={active[0]}
              x2={active[0]}
              y1="0"
              y2={h}
              stroke="var(--primary)"
              strokeWidth="1"
              opacity="0.4"
            />
            <circle
              cx={active[0]}
              cy={active[1]}
              r="4.5"
              fill="var(--primary)"
              stroke="var(--card)"
              strokeWidth="2"
            />
          </g>
        ) : (
          <circle
            cx={pts[pts.length - 1]![0]}
            cy={pts[pts.length - 1]![1]}
            r="4"
            fill="var(--primary)"
            stroke="var(--card)"
            strokeWidth="2"
          />
        )}
      </svg>

      {hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-border bg-popover px-2 py-1 text-[10px] font-semibold text-popover-foreground shadow-card tnum"
          style={{ left: `${(hover / Math.max(1, data.length - 1)) * 100}%` }}
        >
          {format(data[hover]!)}
          {labels?.[hover] ? (
            <span className="block font-normal text-muted-foreground">
              {labels[hover]}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Vodorovný pruh rozdelenia rizika. */
export function RiskBar({
  segments,
}: {
  segments: { value: number; color: string; label: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
        {segments.map((s) => (
          <span
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{
              width: `${(s.value / total) * 100}%`,
              backgroundColor: s.color,
            }}
            className="h-full transition-[width] duration-700"
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span
            key={s.label}
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
            <span className="font-semibold tnum text-foreground">
              {s.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
