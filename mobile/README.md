# PANDORA OS — Mobile Package

This directory contains all **Capacitor mobile-specific** dependencies and configuration for the PANDORA OS application.

## Why this is separate

The root `package.json` is the **Next.js / fullstack web application**. Mobile/Capacitor dependencies are isolated here so that platforms like Base44 correctly identify the root project as a web application.

## Contents

- `package.json` — Capacitor/Expo/React Native dependencies and mobile build scripts
- `capacitor.config.json` — Capacitor runtime configuration (app ID, plugins, server URL profiles)
- `scripts/mobile/` — Mobile profile switcher (`set-profile.mjs`) and Brave dev launcher

## Usage

```bash
# From the root project directory — install root web deps first
npm install

# Then install mobile deps
cd mobile && npm install

# Switch Capacitor server profile
npm run mobile:profile:local
npm run mobile:profile:staging
npm run mobile:profile:prod

# Build the real root Next.js application (static export to ../out) and sync it
# These commands must be run from mobile/.
npm run cap:build
npm run cap:android
npm run cap:ios
```

## Prerequisites

- Android Studio (for Android builds)
- Xcode + Apple Developer account (for iOS builds)
- Capacitor CLI: `npm install -g @capacitor/cli`
