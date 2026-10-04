"use client";

import type React from "react";

import { GL } from "@/components/gl";
import { Pill } from "@/components/ui/pill";
import { useState, useEffect } from "react";
import {
  Search,
  Github,
  Youtube,
  Mail,
  Globe,
  Shield,
  Zap,
} from "lucide-react";

const QUICK_LINKS = [
  { id: "1", title: "Google", url: "https://google.com", icon: Search },
  { id: "2", title: "YouTube", url: "https://youtube.com", icon: Youtube },
  { id: "3", title: "GitHub", url: "https://github.com", icon: Github },
  { id: "4", title: "Gmail", url: "https://mail.google.com", icon: Mail },
  { id: "5", title: "Web", url: "https://example.com", icon: Globe },
  { id: "6", title: "Secure", url: "https://secure.com", icon: Shield },
];

export function Hero() {
  const [hovering, setHovering] = useState(false);
  const [time, setTime] = useState(new Date());
  const [greeting, setGreeting] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    const hour = new Date().getHours();
    if (hour < 12) setGreeting("Good Morning");
    else if (hour < 18) setGreeting("Good Afternoon");
    else setGreeting("Good Evening");
    return () => clearInterval(timer);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery) {
      window.open(
        `https://google.com/search?q=${encodeURIComponent(searchQuery)}`,
        "_blank",
      );
    }
  };

  return (
    <div className="flex flex-col h-svh justify-center items-center">
      <GL hovering={hovering} />

      <div className="relative z-10 w-full max-w-4xl px-8 flex flex-col items-center">
        <div className="text-center mb-8 animate-in slide-in-from-bottom-8 duration-700">
          <Pill className="mb-6">PΛND0RΛ SECURE BROWSER</Pill>
          <h1 className="text-7xl sm:text-8xl font-black tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-br from-primary to-purple-500">
            {time.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </h1>
          <h2 className="text-xl sm:text-2xl font-medium text-foreground/70 mb-2 font-sentient">
            {greeting}, <i className="font-light">EXPLORER</i>
          </h2>
          <p className="text-xs uppercase tracking-widest text-foreground/40 font-mono">
            Your privacy. Your rules. No limits.
          </p>
        </div>

        <form
          onSubmit={handleSearch}
          className="w-full max-w-xl mb-12 relative group"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <div className="absolute inset-0 rounded-full blur-xl opacity-20 group-hover:opacity-40 transition-opacity bg-gradient-to-r from-primary to-purple-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search the web or type a URL..."
            className="w-full py-4 px-8 rounded-full text-lg shadow-2xl outline-none relative transition-all border bg-black/60 backdrop-blur-md border-border text-foreground placeholder-foreground/40 focus:border-primary/50 focus:bg-black/80"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-primary text-background flex items-center justify-center hover:bg-primary/80 transition-colors"
          >
            <Zap className="w-5 h-5" />
          </button>
        </form>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 sm:gap-6 w-full max-w-xl">
          {QUICK_LINKS.map((link, i) => {
            const Icon = link.icon;
            return (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-3 p-4 rounded-2xl transition-all hover:-translate-y-1 hover:bg-foreground/5 group"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-2xl shadow-sm transition-transform group-hover:scale-110 bg-foreground/10 backdrop-blur-sm border border-border group-hover:border-primary/50">
                  <Icon className="w-6 h-6 text-foreground/80 group-hover:text-primary transition-colors" />
                </div>
                <span className="text-xs font-bold text-foreground/60 group-hover:text-primary transition-colors">
                  {link.title}
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
