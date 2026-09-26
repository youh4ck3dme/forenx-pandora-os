import { useEffect, useState } from "react";

const tone: Record<string, string> = {
  critical: "var(--risk-high)",
  high: "var(--risk-high)",
  medium: "var(--risk-medium)",
  low: "var(--risk-low)",
};

/** Radiálny ukazovateľ rizikového skóre s animovaným počítadlom. */
export function RiskGauge({
  score,
  level,
  size = 132,
  label,
}: {
  score: number;
  level: "critical" | "high" | "medium" | "low";
  size?: number;
  label?: string;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = 0.75; // 270°

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Rizikové skóre ${score} zo 100`}
      >
        <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className="opacity-25"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * arc} ${c}`}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone[level]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * arc * (shown / 100)} ${c}`}
            style={{ transition: "stroke-dasharray 80ms linear" }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-current">
        <span className="text-2xl font-extrabold tnum">{shown}</span>
        {label ? (
          <span className="text-[10px] font-semibold opacity-90">{label}</span>
        ) : null}
      </div>
    </div>
  );
}
