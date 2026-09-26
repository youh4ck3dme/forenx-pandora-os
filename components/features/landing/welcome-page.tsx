"use client"
import { GL } from "@/components/gl"
import { useState, useEffect, useRef } from "react"
import { Shield, Fingerprint, Sparkles, ChevronDown, Eye, Zap } from "lucide-react"
import { PandoraLogo } from "@/components/ui/branding/pandora-logo"

export function WelcomePage() {
  const [hovering, setHovering] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showContent, setShowContent] = useState(false)
  const [activeFeature, setActiveFeature] = useState(0)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const features = [
    {
      icon: Fingerprint,
      title: "Biometric Auth",
      description: "FaceID, TouchID, Windows Hello",
    },
    {
      icon: Shield,
      title: "Zero Knowledge",
      description: "Your data stays yours",
    },
    {
      icon: Eye,
      title: "Privacy First",
      description: "No tracking, no logs",
    },
  ]

  useEffect(() => {
    setMounted(true)
    const timer = setTimeout(() => setShowContent(true), 500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [features.length])

  const scrollToContent = () => {
    window.scrollTo({ top: window.innerHeight, behavior: "smooth" })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left - rect.width / 2) / rect.width
    const y = (e.clientY - rect.top - rect.height / 2) / rect.height
    setMousePosition({ x, y })
  }

  if (!mounted) return null

  return (
    <div ref={containerRef} className="relative min-h-svh w-full overflow-hidden">
      {/* Particle Background */}
      <GL hovering={hovering} />

      {/* Gradient Overlays */}
      <div className="absolute inset-0 z-[1] pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/50" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-svh px-6">
        {/* Logo & Badge */}
        <div
          className={`transition-all duration-1000 ${showContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
        >
          <div
            className="flex items-center justify-center gap-4 mb-8"
            style={{
              transform: 'perspective(800px) rotateY(-8deg) rotateX(5deg)',
              transformStyle: 'preserve-3d',
            }}
          >
            <div className="relative" style={{ transform: 'translateZ(30px)' }}>
              <div className="absolute inset-0 blur-2xl bg-purple-500/30 rounded-full animate-pulse" />
              <PandoraLogo size={72} className="relative drop-shadow-2xl" />
            </div>
            <div className="flex flex-col" style={{ transform: 'translateZ(15px)' }}>
              <span className="text-3xl font-black tracking-tight text-foreground drop-shadow-lg">PANDORA</span>
              <span className="text-xs font-mono text-purple-400 tracking-[0.3em] drop-shadow-md">BROWSER</span>
            </div>
          </div>
        </div>

        {/* Main Headline */}
        <div
          className={`text-center max-w-4xl transition-all duration-1000 delay-200 ${showContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter mb-6 leading-[0.9]">
            <span className="text-foreground">Privacy</span>
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 animate-gradient">
              Without Limits
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-foreground/60 max-w-xl mx-auto mb-8 font-light leading-relaxed">
            The next-generation secure browser with{" "}
            <span className="text-purple-400 font-medium">biometric authentication</span>. Your data, your rules.
          </p>
        </div>

        {/* CTA Buttons */}
        <div
          className={`flex flex-col sm:flex-row gap-4 mb-12 transition-all duration-1000 delay-400 ${showContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
        >
          <a
            href="/auth/register"
            className="group relative px-8 py-[14px] rounded-full font-bold text-lg overflow-hidden transition-transform hover:scale-105 active:scale-95"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-blue-500 to-cyan-400" />
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-blue-500 to-cyan-400 blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />
            <span className="relative flex items-center gap-2 text-white">
              <Fingerprint className="w-5 h-5" />
              Setup Biometrics
            </span>
          </a>

          <a
            href="/auth/login"
            className="group px-8 py-[14px] rounded-full font-bold text-lg border border-border bg-black/50 backdrop-blur-sm hover:bg-foreground/10 hover:border-purple-500/50 transition-all"
          >
            <span className="flex items-center gap-2 text-foreground">
              <Zap className="w-5 h-5 text-purple-400" />
              Quick Login
            </span>
          </a>
        </div>

        {/* Feature Pills */}
        <div
          className={`flex flex-wrap justify-center gap-3 mb-16 transition-all duration-1000 delay-600 ${showContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
        >
          {features.map((feature, index) => {
            const Icon = feature.icon
            const isActive = activeFeature === index
            return (
              <div
                key={feature.title}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-sm transition-all duration-500 ${isActive
                  ? "bg-purple-500/20 border-purple-500/50 scale-105"
                  : "bg-black/30 border-border hover:border-foreground/30"
                  }`}
              >
                <Icon className={`w-4 h-4 transition-colors ${isActive ? "text-purple-400" : "text-foreground/60"}`} />
                <span
                  className={`text-sm font-medium transition-colors ${isActive ? "text-purple-400" : "text-foreground/60"
                    }`}
                >
                  {feature.title}
                </span>
              </div>
            )
          })}
        </div>

        {/* Scroll Indicator */}
        <button
          onClick={scrollToContent}
          className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-foreground/40 hover:text-purple-400 transition-all duration-1000 delay-800 ${showContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
        >
          <span className="text-xs font-mono tracking-widest uppercase">Explore</span>
          <ChevronDown className="w-5 h-5 animate-bounce" />
        </button>

        {/* Floating Elements */}
        <div className="absolute top-1/4 left-8 sm:left-16 opacity-20 animate-float">
          <Sparkles className="w-8 h-8 text-purple-400" />
        </div>
        <div className="absolute top-1/3 right-8 sm:right-16 opacity-20 animate-float-delayed">
          <Shield className="w-10 h-10 text-blue-400" />
        </div>
        <div className="absolute bottom-1/4 left-12 sm:left-24 opacity-20 animate-float">
          <PandoraLogo size={32} className="opacity-50" />
        </div>
      </div>
    </div>
  )
}
