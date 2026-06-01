# =============================================================================
# newsLookup Gen2 - Windows Uninstall Script
# =============================================================================
# Run from the project root:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\uninstall-windows.ps1
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

# -- Colours ------------------------------------------------------------------
function Write-Header { param($msg) Write-Host "" ; Write-Host "===  $msg  ===" -ForegroundColor Cyan }
function Write-Ok     { param($msg) Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Skip   { param($msg) Write-Host "  [--]   $msg" -ForegroundColor DarkGray }
function Write-Info   { param($msg) Write-Host "  [..]   $msg" -ForegroundColor Yellow }
function Write-Fail   { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red }

function Confirm-Step {
    param([string]$Question)
    Write-Host ""
    Write-Host "  [?]  $Question [Y/N]: " -ForegroundColor Magenta -NoNewline
    $ans = Read-Host
    return ($ans -match '^[Yy]$')
}

# =============================================================================
# BANNER
# =============================================================================
Clear-Host
Write-Host ""
Write-Host "  newsLookup Gen2 - Uninstall Script for Windows" -ForegroundColor Cyan
Write-Host "  -------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  This script will:" -ForegroundColor White
Write-Host "    1. Stop Ollama if running" -ForegroundColor White
Write-Host "    2. Uninstall Ollama" -ForegroundColor White
Write-Host "    3. Optionally delete pulled models (~/.ollama)" -ForegroundColor White
Write-Host "    4. Optionally delete project config files" -ForegroundColor White
Write-Host ""

if (-not (Confirm-Step "Continue with uninstall?")) {
    Write-Host ""
    Write-Skip "Uninstall cancelled."
    exit 0
}

# =============================================================================
# STEP 1 - Stop Ollama process
# =============================================================================
Write-Header "STEP 1 - Stop Ollama"

$ollamaProcess = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaProcess) {
    try {
        Stop-Process -Name "ollama" -Force
        Write-Ok "Ollama process stopped"
    } catch {
        Write-Fail "Failed to stop Ollama process: $_"
    }
} else {
    Write-Skip "Ollama is not running"
}

# Also stop ollama app tray if present
$ollamaApp = Get-Process -Name "ollama app" -ErrorAction SilentlyContinue
if ($ollamaApp) {
    Stop-Process -Name "ollama app" -Force -ErrorAction SilentlyContinue
    Write-Ok "Ollama tray app stopped"
}

Start-Sleep -Seconds 2

# =============================================================================
# STEP 2 - Uninstall Ollama
# =============================================================================
Write-Header "STEP 2 - Uninstall Ollama"

$ollamaInstalled = $false
try {
    $null = & ollama --version 2>$null
    $ollamaInstalled = $true
} catch { }

if ($ollamaInstalled) {
    $wingetAvailable = $false
    try { $null = & winget --version 2>$null; $wingetAvailable = $true } catch { }

    if ($wingetAvailable) {
        Write-Info "Running: winget uninstall Ollama.Ollama"
        try {
            & winget uninstall --id Ollama.Ollama --accept-source-agreements
            Write-Ok "Ollama uninstalled via winget"
        } catch {
            Write-Fail "winget uninstall failed: $_"
            Write-Host "  Try manually: Control Panel > Programs > Uninstall Ollama" -ForegroundColor Yellow
        }
    } else {
        Write-Fail "winget not available."
        Write-Host "  Uninstall manually: Control Panel > Programs > Uninstall Ollama" -ForegroundColor Yellow
    }
} else {
    Write-Skip "Ollama is not installed"
}

# =============================================================================
# STEP 3 - Delete pulled models (~/.ollama)
# =============================================================================
Write-Header "STEP 3 - Pulled Ollama Models"

$ollamaModelDir = Join-Path $env:USERPROFILE ".ollama"

if (Test-Path $ollamaModelDir) {
    Write-Info "Found Ollama model folder: $ollamaModelDir"
    Write-Info "This contains all pulled models (qwen3-embedding:8b, qwen2.5:7b, etc.)"
    Write-Info "Deleting this folder will require re-pulling models after reinstall."

    if (Confirm-Step "Delete all pulled Ollama models? ($ollamaModelDir)") {
        try {
            Remove-Item -Path $ollamaModelDir -Recurse -Force
            Write-Ok "Ollama model folder deleted: $ollamaModelDir"
        } catch {
            Write-Fail "Failed to delete model folder: $_"
        }
    } else {
        Write-Skip "Ollama models kept at $ollamaModelDir"
    }
} else {
    Write-Skip "Ollama model folder not found ($ollamaModelDir)"
}

# =============================================================================
# STEP 4 - Delete project config files
# =============================================================================
Write-Header "STEP 4 - Project Config Files"

$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }

Write-Info "Project root: $ProjectRoot"
Write-Host ""

# .env
$envPath = Join-Path $ProjectRoot ".env"
if (Test-Path $envPath) {
    if (Confirm-Step "Delete .env?") {
        Remove-Item -Path $envPath -Force
        Write-Ok ".env deleted"
    } else {
        Write-Skip ".env kept"
    }
} else {
    Write-Skip ".env not found"
}

# .env.backup
$envBackupPath = Join-Path $ProjectRoot ".env.backup"
if (Test-Path $envBackupPath) {
    if (Confirm-Step "Delete .env.backup?") {
        Remove-Item -Path $envBackupPath -Force
        Write-Ok ".env.backup deleted"
    } else {
        Write-Skip ".env.backup kept"
    }
} else {
    Write-Skip ".env.backup not found"
}

# rss-sites.json
$rssSitesPath = Join-Path $ProjectRoot "rss-sites.json"
if (Test-Path $rssSitesPath) {
    if (Confirm-Step "Delete rss-sites.json?") {
        Remove-Item -Path $rssSitesPath -Force
        Write-Ok "rss-sites.json deleted"
    } else {
        Write-Skip "rss-sites.json kept"
    }
} else {
    Write-Skip "rss-sites.json not found"
}

# node_modules
$nodeModulesPath = Join-Path $ProjectRoot "node_modules"
if (Test-Path $nodeModulesPath) {
    if (Confirm-Step "Delete node_modules folder?") {
        try {
            Remove-Item -Path $nodeModulesPath -Recurse -Force
            Write-Ok "node_modules deleted"
        } catch {
            Write-Fail "Failed to delete node_modules: $_"
        }
    } else {
        Write-Skip "node_modules kept"
    }
} else {
    Write-Skip "node_modules not found"
}

# =============================================================================
# FINAL REPORT
# =============================================================================
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  UNINSTALL COMPLETE" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# Ollama
try {
    $null = & ollama --version 2>$null
    Write-Fail "Ollama         still detected - may need manual uninstall"
} catch {
    Write-Ok  "Ollama         not detected"
}

# Model folder
if (Test-Path $ollamaModelDir) {
    Write-Info "Models         $ollamaModelDir still present (kept)"
} else {
    Write-Ok  "Models         removed"
}

# Config files
if (Test-Path $envPath)         { Write-Info ".env           still present (kept)" }
else                            { Write-Ok  ".env           removed" }

if (Test-Path $rssSitesPath)    { Write-Info "rss-sites      still present (kept)" }
else                            { Write-Ok  "rss-sites      removed" }

if (Test-Path $nodeModulesPath) { Write-Info "node_modules   still present (kept)" }
else                            { Write-Ok  "node_modules   removed" }

Write-Host ""
Write-Host "  Note: Node.js was not touched by this script." -ForegroundColor DarkGray
Write-Host "  To uninstall Node.js: Control Panel > Programs > Uninstall Node.js" -ForegroundColor DarkGray
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
