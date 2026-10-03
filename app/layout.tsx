import type React from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/core/providers/service-worker-registration";
import { ObservabilityReporter } from "@/components/forza/ObservabilityReporter";
import { QueryProvider } from "@/components/core/providers/query-provider";
import { AuthCookieSync } from "@/components/core/providers/auth-cookie-sync";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pandora.whoiswho.at"),
  title: "FORENX PΛND0RΛ OS | Suverénny forenzný a vyšetrovací systém",
  description:
    "Autonómna platforma pre digitálne vyšetrovanie, analýzu finančných tokov, entitné grafy a nemenné WORM úložisko dôkazov.",
  keywords: [
    "forensics",
    "investigation",
    "intelligence",
    "graph",
    "evidence",
    "vault",
    "worm",
    "pandora",
    "forenx",
  ],
  authors: [{ name: "PΛND0RΛ Team" }],
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-dark-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FORENX PΛND0RΛ OS",
  },
  openGraph: {
    type: "website",
    title: "FORENX PΛND0RΛ OS | Suverénny forenzný a vyšetrovací systém",
    description:
      "Autonómna platforma pre digitálne vyšetrovanie, analýzu finančných tokov, entitné grafy a nemenné WORM úložisko dôkazov.",
    siteName: "FORENX PΛND0RΛ OS",
    images: [
      {
        url: "/og-share.png",
        width: 1200,
        height: 630,
        alt: "FORENX PANDORA OS - Suverénny forenzný a vyšetrovací systém",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FORENX PΛND0RΛ OS | Suverénny forenzný a vyšetrovací systém",
    description:
      "Autonómna platforma pre digitálne vyšetrovanie, analýzu finančných tokov, entitné grafy a nemenné WORM úložisko dôkazov.",
    images: ["/og-share.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("malte:theme")||"light";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";if(window.self!==window.top){document.documentElement.classList.add("is-embedded")}}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans tracking-tight`}
        suppressHydrationWarning
      >
        <QueryProvider>
          <AuthCookieSync />
          <ObservabilityReporter />
          {children}
          <Toaster richColors position="top-right" />
          <ServiceWorkerRegistration />
        </QueryProvider>
      </body>
    </html>
  );
}
