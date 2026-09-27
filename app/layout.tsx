import type React from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/core/providers/service-worker-registration";
import { ObservabilityReporter } from "@/components/forza/ObservabilityReporter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PΛND0RΛ | Browser - Privacy Without Limits",
  description:
    "Next-generation secure browser with biometric authentication and privacy-first design.",
  keywords: [
    "browser",
    "privacy",
    "webauthn",
    "biometric",
    "secure",
    "pandora",
  ],
  authors: [{ name: "PΛND0RΛ Team" }],
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.svg",
    apple: "/icons/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PΛND0RΛ",
  },
  openGraph: {
    type: "website",
    title: "PΛND0RΛ | Browser",
    description: "Privacy-first browser with biometric authentication",
    siteName: "PΛND0RΛ Browser",
  },
  twitter: {
    card: "summary_large_image",
    title: "PΛND0RΛ | Browser",
    description: "Privacy-first browser with biometric authentication",
  },
  generator: "v0.app",
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
        <ObservabilityReporter />
        {children}
        <Toaster richColors position="top-right" />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
