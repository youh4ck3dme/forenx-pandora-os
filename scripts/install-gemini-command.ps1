<#PSScriptInfo

.VERSION 1.0.0
.GUID 87654321-4321-4321-4321-210987654321
.AUTHOR PANDORA Team
.COMPANYNAME FORENX
.COPYRIGHT (c) 2026

.TITLE FORENX/PANDORA Gemini Quality Gate Installer

.DESCRIPTION
Safely installs the 'gemini' function to the current user's PowerShell profile.

Requirements:
- PowerShell 5.1 or later
- Current user has write access to their profile
- No Administrator privileges required

Idempotent: Running multiple times will not duplicate the function.

#>

<#
FORENX / PANDORA - Gemini Quality Gate PowerShell Command Installer

This script:
1. Creates PowerShell profile if it doesn't exist
2. Creates a backup of existing profile
3. Adds the 'gemini' function with clear markers
4. Is idempotent - running twice won't duplicate
5. Never requires Administrator privileges

Markers:
# BEGIN FORENX GEMINI QUALITY GATE
...
# END FORENX GEMINI QUALITY GATE

Usage:
  .\scripts\install-gemini-command.ps1
  
Then reload your PowerShell profile:
  . $PROFILE

Or open a new PowerShell window.
#>

# Require PowerShell 5.1 or later
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Error "FORENX GEMINI QUALITY GATE ERROR: PowerShell 5.1 or later is required."
    exit 3
}

# Configuration
$BEGIN_MARKER = "# BEGIN FORENX GEMINI QUALITY GATE"
$END_MARKER = "# END FORENX GEMINI QUALITY GATE"

# Repository root
$repoRoot = $PSScriptRoot
if (-not $repoRoot) {
    $repoRoot = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
}

# Get the profile path
$profilePath = $PROFILE
if (-not $profilePath) {
    # For different scopes
    if ($Host.Runspace.TypeName -eq "Microsoft.PowerShell.ISE.ISERunspace") {
        $profilePath = [System.IO.Path]::Combine($HOME, "Documents\WindowsPowerShell\Microsoft.PowerShell_ISE_profile.ps1")
    } else {
        $profilePath = [System.IO.Path]::Combine($HOME, "Documents\PowerShell\Microsoft.PowerShell_profile.ps1")
    }
}

Write-Host "FORENX GEMINI QUALITY GATE INSTALLER"
Write-Host "======================================"
Write-Host ""

# Check if profile exists
$profileExists = Test-Path -Path $profilePath -PathType Leaf

if (-not $profileExists) {
    Write-Host "Creating PowerShell profile: $profilePath"
    try {
        New-Item -Path $profilePath -ItemType File -Force | Out-Null
        $profileExists = $true
    } catch {
        Write-Error "Failed to create profile: $_"
        exit 3
    }
}

# Create backup
$backupPath = "$profilePath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
try {
    Copy-Item -Path $profilePath -Destination $backupPath -Force -ErrorAction SilentlyContinue
    Write-Host "Profile backup created: $backupPath"
} catch {
    Write-Warning "Could not create backup: $_"
}

# Read existing profile
$profileContent = Get-Content -Path $profilePath -Raw -ErrorAction SilentlyContinue
if (-not $profileContent) {
    $profileContent = ""
}

# Check if already installed
$beginIndex = $profileContent.IndexOf($BEGIN_MARKER)
$endIndex = $profileContent.IndexOf($END_MARKER)

if ($beginIndex -ge 0 -and $endIndex -ge 0 -and $beginIndex -lt $endIndex) {
    Write-Host ""
    Write-Host "Already installed. No changes made."
    Write-Host "To reload, run: . $PROFILE"
    Write-Host ""
    Write-Host "READY COMMAND:"
    Write-Host "gemini skontroluj"
    exit 0
}

# Build the function to add
$functionCode = @"

$BEGIN_MARKER

# FORENX / PANDORA - Gemini Quality Gate Command
# This function provides a native PowerShell command for the independent
# Gemini code quality reviewer.
# 
# Usage: gemini skontroluj
# 
# Security: STRICTLY READ-ONLY. Never modifies repository.

function gemini {
    param(
        [Parameter(Position=0)]
        [string]`$Command,

        [Parameter(ValueFromRemainingArguments=`$true)]
        [string[]]`$Arguments
    )

    switch (`$Command) {
        "skontroluj" {
            # Invoke the actual implementation
            `$repoRoot = `$null
            `$currentDir = Get-Location
            `$depth = 0
            `$maxDepth = 20

            while (`$depth -lt `$maxDepth) {
                `$gitDir = Join-Path -Path `$currentDir -ChildPath ".git"
                if (Test-Path -Path `$gitDir -PathType Container) {
                    `$repoRoot = `$currentDir
                    break
                }

                `$parentDir = Split-Path -Path `$currentDir -Parent
                if (`$parentDir -eq `$currentDir -or [string]::IsNullOrEmpty(`$parentDir)) {
                    break
                }

                `$currentDir = `$parentDir
                `$depth++
            }

            if (-not `$repoRoot) {
                try {
                    `$repoRoot = git rev-parse --show-toplevel 2>`$null
                } catch {
                    `$repoRoot = `$null
                }
            }

            if (-not `$repoRoot) {
                Write-Error "GEMINI QUALITY GATE ERROR: Not inside a Git repository."
                return 3
            }

            `$originalDir = Get-Location
            try {
                Set-Location -Path `$repoRoot -ErrorAction Stop

                `$apiKey = `$env:GEMINI_API_KEY
                if ([string]::IsNullOrWhiteSpace(`$apiKey) -or `$apiKey.Length -lt 16) {
                    Write-Error "GEMINI QUALITY GATE ERROR: GEMINI_API_KEY is not set or is invalid."
                    Write-Host ""
                    Write-Host "Set it in your environment:"
                    Write-Host "  `$env:GEMINI_API_KEY = \"your-api-key-here\""
                    return 3
                }

                `$branch = git branch --show-current 2>`$null
                `$head = git rev-parse HEAD 2>`$null
                `$status = git status --short 2>`$null
                `$changedCount = if (`$status) { (`$status -split "`n" | Where-Object { `$_ -ne "" }).Count } else { 0 }

                Write-Host ""
                Write-Host "FORENX GEMINI QUALITY GATE"
                Write-Host ""
                Write-Host "Branch: `$branch"
                Write-Host "HEAD: `$($head.Substring(0, [Math]::Min(8, `$head.Length)))"
                Write-Host "Changed: `$changedCount files"
                Write-Host ""

                # Invoke the actual script
                `$scriptPath = Join-Path -Path `$repoRoot -ChildPath "scripts\gemini.ps1"
                if (Test-Path -Path `$scriptPath) {
                    & `$scriptPath skontroluj
                    return `$LASTEXITCODE
                } else {
                    Write-Error "GEMINI QUALITY GATE ERROR: scripts/gemini.ps1 not found in repository."
                    return 3
                }
            }
            finally {
                Set-Location -Path `$originalDir
            }
        }

        default {
            Write-Host "Usage: gemini skontroluj"
            return 1
        }
    }
}

$END_MARKER

"@

# Check if profile has content and doesn't end with newline
$needsNewlineBefore = $false
if ($profileContent.Length -gt 0 -and -not $profileContent.EndsWith([Environment]::NewLine)) {
    $needsNewlineBefore = $true
}

# Build new profile content
$newContent = $profileContent
if ($needsNewlineBefore) {
    $newContent += [Environment]::NewLine
}
$newContent += $functionCode

# Write new profile
try {
    Set-Content -Path $profilePath -Value $newContent -Force
    Write-Host "Profile updated: $profilePath"
} catch {
    Write-Error "Failed to update profile: $_"
    exit 3
}

Write-Host ""
Write-Host "Installation complete!"
Write-Host ""
Write-Host "To use the command, reload your PowerShell profile:"
Write-Host "  . `$PROFILE"
Write-Host ""
Write-Host "Or open a new PowerShell window and navigate to the repository."
Write-Host ""
Write-Host "Then type:"
Write-Host ""
Write-Host "READY COMMAND:"
Write-Host "gemini skontroluj"
Write-Host ""

# Verify installation
Write-Host "Verifying installation..."
$verified = `$false
try {
    # Source the profile in a new scope
    $script:tempProfile = $profilePath
    $script:functionTest = {
        . $script:tempProfile 2>$null
        if (Get-Command gemini -ErrorAction SilentlyContinue) {
            return $true
        }
        return $false
    }
    $verified = & $script:functionTest
} catch {
    $verified = $false
}

if ($verified) {
    Write-Host "✓ Command 'gemini' is available."
} else {
    Write-Host "⚠ Could not verify command. Try reloading profile manually."
}

Write-Host ""
