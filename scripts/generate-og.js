const sharp = require('sharp');
const fs = require('fs');

const width = 1200;
const height = 630;

const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#08090C" />
      <stop offset="50%" stop-color="#0D1117" />
      <stop offset="100%" stop-color="#050608" />
    </linearGradient>
    <linearGradient id="cyanGlow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="100%" stop-color="#10b981" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="40" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg)" />

  <!-- Subtle grid lines -->
  <g stroke="rgba(255,255,255,0.03)" stroke-width="1">
    <line x1="100" y1="0" x2="100" y2="630" />
    <line x1="300" y1="0" x2="300" y2="630" />
    <line x1="600" y1="0" x2="600" y2="630" />
    <line x1="900" y1="0" x2="900" y2="630" />
    <line x1="1100" y1="0" x2="1100" y2="630" />
    <line x1="0" y1="100" x2="1200" y2="100" />
    <line x1="0" y1="315" x2="1200" y2="315" />
    <line x1="0" y1="530" x2="1200" y2="530" />
  </g>

  <!-- Glowing accent orb in top right -->
  <circle cx="1000" cy="150" r="180" fill="#06b6d4" opacity="0.12" filter="url(#glow)" />
  <circle cx="200" cy="500" r="160" fill="#10b981" opacity="0.08" filter="url(#glow)" />

  <!-- Header Badge -->
  <rect x="80" y="80" width="280" height="36" rx="18" fill="rgba(6, 182, 212, 0.12)" stroke="rgba(6, 182, 212, 0.35)" stroke-width="1" />
  <circle cx="102" cy="98" r="5" fill="#10b981" />
  <text x="118" y="103" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#38bdf8" letter-spacing="1.5">SOVEREIGN FORENSIC OS</text>

  <!-- Main Title -->
  <text x="80" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="54" font-weight="800" fill="#ffffff" letter-spacing="-1">FORENX P&#923;ND0R&#923; OS</text>

  <!-- Subtitle -->
  <text x="80" y="255" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="500" fill="url(#cyanGlow)">Suverénny forenzný a vyšetrovací systém</text>

  <!-- Description paragraph -->
  <text x="80" y="330" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="400" fill="#94a3b8">Autonómna platforma pre digitálne vyšetrovanie, analýzu finančných</text>
  <text x="80" y="365" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="400" fill="#94a3b8">tokov, entitné grafy a nemenné WORM úložisko dôkazov.</text>

  <!-- 3 Feature Chips -->
  <g transform="translate(80, 440)">
    <!-- Chip 1 -->
    <rect x="0" y="0" width="310" height="75" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
    <text x="24" y="32" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#38bdf8">WORM DÔKAZOVÝ TREZOR</text>
    <text x="24" y="54" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="400" fill="#64748b">Nemenný SHA-256 audit log</text>

    <!-- Chip 2 -->
    <rect x="330" y="0" width="310" height="75" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
    <text x="24" y="32" transform="translate(330, 0)" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#34d399">AI SENTINEL &amp; GRAF</text>
    <text x="24" y="54" transform="translate(330, 0)" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="400" fill="#64748b">Prepojenie subjektov a tokov</text>

    <!-- Chip 3 -->
    <rect x="660" y="0" width="310" height="75" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
    <text x="24" y="32" transform="translate(660, 0)" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#a78bfa">BIOMETRICKÝ HARDENING</text>
    <text x="24" y="54" transform="translate(660, 0)" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="400" fill="#64748b">WebAuthn FIDO2 / Passkeys</text>
  </g>

  <!-- Bottom URL -->
  <text x="80" y="580" font-family="monospace" font-size="15" font-weight="600" fill="#475569">pandora.whoiswho.at</text>
</svg>
`;

sharp(Buffer.from(svg))
  .png({ quality: 95 })
  .toFile('public/og-share.png')
  .then(info => {
    console.log('SUCCESS: public/og-share.png generated:', info);
  })
  .catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
  });
