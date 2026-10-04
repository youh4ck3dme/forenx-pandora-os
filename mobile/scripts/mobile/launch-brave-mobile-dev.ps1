# Launcher for Brave Developer Profile (Mobile & DevTools)
param(
    [switch]$Mobile = $true,
    [string]$Url = "http://localhost:3000"
)

$BravePaths = @(
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"
)

$BraveExe = $BravePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $BraveExe) {
    Write-Error "Brave Browser was not found in standard paths."
    exit 1
}

$ProfileDir = "$env:USERPROFILE\.pandora-brave-dev-profile"
if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}

$ArgsList = @(
    "--user-data-dir=$ProfileDir",
    "--remote-debugging-port=9222",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--auto-open-devtools-for-tabs"
)

if ($Mobile) {
    $ArgsList += "--window-size=430,932"
    $ArgsList += "--user-agent=Mozilla/5.0 (Linux; Android 14; Mobile; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 PandoraMobile/1.0"
} else {
    $ArgsList += "--window-size=1400,900"
}

$ArgsList += $Url
$ArgsList += "chrome://inspect/#devices"

Write-Host "🚀 Spúšťam Brave Developer Profile (Mobile & Remote Debugging)..." -ForegroundColor Cyan
Write-Host "📂 Profil: $ProfileDir" -ForegroundColor Gray
Write-Host "🌐 Dev URL: $Url" -ForegroundColor Gray
Write-Host "📱 Remote Inspect: chrome://inspect/#devices" -ForegroundColor Gray

Start-Process -FilePath $BraveExe -ArgumentList $ArgsList
