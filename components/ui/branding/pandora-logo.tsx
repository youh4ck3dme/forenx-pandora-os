"use client"

interface PandoraLogoProps {
  size?: number
  className?: string
}

export function PandoraLogo({ size = 64, className = "" }: PandoraLogoProps) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="diamondGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#9333ea" }} />
          <stop offset="50%" style={{ stopColor: "#3b82f6" }} />
          <stop offset="100%" style={{ stopColor: "#06b6d4" }} />
        </linearGradient>
        <linearGradient id="highlightGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#c084fc" }} />
          <stop offset="100%" style={{ stopColor: "#7c3aed" }} />
        </linearGradient>
        <linearGradient id="shadowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#6366f1" }} />
          <stop offset="100%" style={{ stopColor: "#1e1b4b" }} />
        </linearGradient>
        <linearGradient id="leftGradient" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#818cf8" }} />
          <stop offset="100%" style={{ stopColor: "#4f46e5" }} />
        </linearGradient>
        <linearGradient id="rightGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#38bdf8" }} />
          <stop offset="100%" style={{ stopColor: "#0284c7" }} />
        </linearGradient>
        <linearGradient id="centerGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#a78bfa" }} />
          <stop offset="100%" style={{ stopColor: "#7c3aed" }} />
        </linearGradient>
      </defs>
      <polygon points="256,48 160,140 352,140" fill="url(#highlightGradient)" />
      <polygon points="160,140 48,180 180,220 256,140" fill="url(#leftGradient)" />
      <polygon points="352,140 464,180 332,220 256,140" fill="url(#rightGradient)" />
      <polygon points="180,220 256,140 332,220 256,260" fill="url(#centerGradient)" />
      <polygon points="48,180 180,220 256,464" fill="url(#diamondGradient)" />
      <polygon points="464,180 332,220 256,464" fill="url(#shadowGradient)" />
      <polygon points="180,220 332,220 256,464" fill="url(#diamondGradient)" opacity="0.9" />
    </svg>
  )
}
