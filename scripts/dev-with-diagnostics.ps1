[CmdletBinding()]
param(
  [ValidateSet("dev", "build", "start", "typecheck")]
  [string]$NpmScript = "dev"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$diagnosticsDir = Join-Path $repoRoot "docs\diagnostics"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $diagnosticsDir "$NpmScript-$timestamp.log"

New-Item -ItemType Directory -Path $diagnosticsDir -Force | Out-Null

$header = @(
  "PΛND0RΛ local diagnostics",
  "started_at=$(Get-Date -Format o)",
  "command=npm run $NpmScript",
  "repo=$repoRoot",
  "node=$(& node --version)",
  "npm=$(& npm --version)",
  "----------------------------------------"
) -join [Environment]::NewLine

$header | Set-Content -LiteralPath $logPath -Encoding utf8
Write-Host "Diagnostický log: $logPath" -ForegroundColor Cyan
Write-Host "Zastavenie: Ctrl+C" -ForegroundColor DarkGray

Push-Location $repoRoot
try {
  # cmd.exe preserves npm's native Windows text encoding in the transcript.
  & cmd.exe /d /c "npm run $NpmScript 2>&1" |
    Tee-Object -FilePath $logPath -Append
  $exitCode = $LASTEXITCODE
}
finally {
  Pop-Location
}

Add-Content -LiteralPath $logPath -Value "----------------------------------------"
Add-Content -LiteralPath $logPath -Value "finished_at=$(Get-Date -Format o)"
Add-Content -LiteralPath $logPath -Value "exit_code=$exitCode"

exit $exitCode
