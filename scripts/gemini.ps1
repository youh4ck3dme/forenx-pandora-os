<#PSScriptInfo

.VERSION 1.0.0
.GUID 12345678-1234-1234-1234-123456789012
.AUTHOR PANDORA Team
.COMPANYNAME FORENX
.COPYRIGHT (c) 2026

.TITLE FORENX/PANDORA Gemini Quality Gate PowerShell Command

.DESCRIPTION
Launches the FORENX/PANDORA independent Gemini Quality Gate reviewer.

Usage: gemini skontroluj

This command reviews the current working tree changes relative to HEAD.
It is STRICTLY READ-ONLY and will never modify your repository.

#>

<#
FORENX / PANDORA - Gemini Quality Gate PowerShell Command

SECURITY: This script is a thin launcher only.
- Never modifies repository files
- Never executes arbitrary shell commands from AI
- Only calls npm run quality:gemini with predefined arguments
- All review logic is in the TypeScript quality-gate module

Command: gemini skontroluj
Meaning: Review current working tree delta relative to HEAD
#>

# Require PowerShell 5.1 or later
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Error "FORENX GEMINI QUALITY GATE ERROR: PowerShell 5.1 or later is required."
    exit 3
}

# Main function
function Invoke-ForenxGemini {
    param(
        [Parameter(Position=0, Mandatory=$true)]
        [ValidateSet("skontroluj")]
        [string]$Command,

        [Parameter(ValueFromRemainingArguments=$true)]
        [string[]]$Arguments
    )

    process {
        switch ($Command) {
            "skontroluj" {
                # Find repository root
                $repoRoot = [string](Find-GitRepositoryRoot)
                if (-not $repoRoot) {
                    Write-Error "GEMINI QUALITY GATE ERROR: Not inside a Git repository."
                    exit 3
                }

                # Change to repository root
                $originalDir = (Get-Location).Path
                try {
                    Set-Location -Path $repoRoot -ErrorAction Stop

                    # Check if we're in the forenx-pandora-os repository
                    $expectedPath = "C:\Projects\forenzX-pandora-os\forenx-pandora-os"
                    if ($repoRoot -ne $expectedPath -and -not ($repoRoot.EndsWith("forenx-pandora-os"))) {
                        Write-Warning "GEMINI QUALITY GATE WARNING: Not in forenx-pandora-os repository at $expectedPath"
                        Write-Warning "Proceeding with detected repository: $repoRoot"
                    }

                    # Check for GEMINI_API_KEY
                    $apiKey = $env:GEMINI_API_KEY
                    if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey.Length -lt 16) {
                        $envLocalPath = Join-Path $repoRoot ".env.local"
                        if (Test-Path $envLocalPath) {
                            $match = Select-String -Path $envLocalPath -Pattern '^\s*GEMINI_API_KEY\s*=\s*["'']?([^"''\r\n]+)["'']?' | Select-Object -First 1
                            if ($match -and $match.Matches[0].Groups[1].Value) {
                                $apiKey = $match.Matches[0].Groups[1].Value.Trim()
                                $env:GEMINI_API_KEY = $apiKey
                            }
                            $modelMatch = Select-String -Path $envLocalPath -Pattern '^\s*GEMINI_QUALITY_MODEL\s*=\s*["'']?([^"''\r\n]+)["'']?' | Select-Object -First 1
                            if ($modelMatch -and $modelMatch.Matches[0].Groups[1].Value) {
                                $env:GEMINI_QUALITY_MODEL = $modelMatch.Matches[0].Groups[1].Value.Trim()
                            }
                        }
                    }

                    if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey.Length -lt 16) {
                        Write-Error "GEMINI QUALITY GATE ERROR: GEMINI_API_KEY is not set or is invalid."
                        Write-Host ""
                        Write-Host "To use the quality gate, you need a Google Gemini API key."
                        Write-Host "Set it in your environment:"
                        Write-Host "  `$env:GEMINI_API_KEY = \"your-api-key-here\""
                        Write-Host ""
                        Write-Host "Or add it to your .env.local file:"
                        Write-Host "  GEMINI_API_KEY=your-api-key-here"
                        Write-Host ""
                        Write-Host "Note: The API key is SERVER-ONLY and will never be exposed to the browser."
                        exit 3
                    }

                    # Collect git context information for display
                    $branch = git branch --show-current 2>$null
                    $head = git rev-parse HEAD 2>$null
                    $status = git status --short 2>$null
                    $changedCount = if ($status) { ($status -split "`n" | Where-Object { $_ -ne "" }).Count } else { 0 }

                    Write-Host ""
                    Write-Host "FORENX GEMINI QUALITY GATE"
                    Write-Host ""
                    Write-Host "Branch: $branch"
                    Write-Host "HEAD: $($head.Substring(0, [Math]::Min(8, $head.Length)))"
                    Write-Host "Changed: $changedCount files"
                    if ($env:GEMINI_QUALITY_MODEL) {
                        Write-Host "Model: $env:GEMINI_QUALITY_MODEL"
                    }
                    Write-Host ""

                    # Run the quality gate with working-tree scope
                    & npm.cmd run quality:gemini -- --scope working-tree --write-output @Arguments
                    $exitCode = $LASTEXITCODE

                    exit $exitCode
                }
                finally {
                    Set-Location -Path $originalDir
                }
            }

            default {
                Write-Host "Usage: gemini skontroluj"
                exit 1
            }
        }
    }
}

# Find Git repository root
function Find-GitRepositoryRoot {
    $currentDir = (Get-Location).Path
    $depth = 0
    $maxDepth = 20

    while ($depth -lt $maxDepth) {
        $gitDir = Join-Path -Path $currentDir -ChildPath ".git"
        if (Test-Path -Path $gitDir -PathType Container) {
            return $currentDir
        }

        $parentDir = Split-Path -Path $currentDir -Parent
        if ($parentDir -eq $currentDir -or [string]::IsNullOrEmpty($parentDir)) {
            break
        }

        $currentDir = $parentDir
        $depth++
    }

    # Try using git command
    try {
        $gitRoot = git rev-parse --show-toplevel 2>$null
        if (-not [string]::IsNullOrEmpty($gitRoot) -and (Test-Path -Path $gitRoot)) {
            return $gitRoot
        }
    }
    catch {
        # git not available
    }

    return $null
}

# Main execution
if ($MyInvocation.MyCommand.Name -eq "gemini.ps1") {
    # Direct script invocation with arguments
    if ($args.Count -gt 0) {
        Invoke-ForenxGemini -Command $args[0] -Arguments $args[1..$args.Count]
    } else {
        Write-Host "Usage: gemini skontroluj"
        exit 1
    }
}

