# =============================================================================
# newsLookup Gen2 - Windows Setup Script
# =============================================================================
# Run from the project root:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup-windows.ps1
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# -- Colours ------------------------------------------------------------------
function Write-Header { param($msg) Write-Host "" ; Write-Host "===  $msg  ===" -ForegroundColor Cyan }
function Write-Ok     { param($msg) Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Skip   { param($msg) Write-Host "  [--]   $msg (already installed, skipping)" -ForegroundColor DarkGray }
function Write-Info   { param($msg) Write-Host "  [..]   $msg" -ForegroundColor Yellow }
function Write-Fail   { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red }

# -- Helper: yes/no prompt ----------------------------------------------------
function Confirm-Step {
    param([string]$Question)
    Write-Host ""
    Write-Host "  [?]  $Question [Y/N]: " -ForegroundColor Magenta -NoNewline
    $ans = Read-Host
    return ($ans -match '^[Yy]')
}

# =============================================================================
# BANNER
# =============================================================================
Clear-Host
Write-Host ""
Write-Host "  newsLookup Gen2 - Setup Script for Windows" -ForegroundColor Cyan
Write-Host "  -------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

# =============================================================================
# STEP 0 - Confirm project root
# =============================================================================
Write-Header "STEP 0 - Project Root"

$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }

Write-Info "Project root: $ProjectRoot"

if (-not (Test-Path (Join-Path $ProjectRoot "server.js"))) {
    Write-Fail "server.js not found in $ProjectRoot"
    Write-Host "  Please run this script from the newsLookup project root folder." -ForegroundColor Red
    exit 1
}
Write-Ok "server.js found - correct directory confirmed"

# -- Helper: compare semver --------------------------------------------------
# Returns $true if $actual >= $required (compares major.minor.patch)
function Test-Version {
    param([string]$Actual, [string]$Required)
    $a = $Actual  -replace '[^0-9.]','' -split '\.' | ForEach-Object { [int]$_ }
    $r = $Required -split '\.' | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt $r.Count; $i++) {
        $av = if ($i -lt $a.Count) { $a[$i] } else { 0 }
        if ($av -gt $r[$i]) { return $true }
        if ($av -lt $r[$i]) { return $false }
    }
    return $true
}

# =============================================================================
# STEP 1 - Node.js (required >= 22.0.0 for ESM support)
# =============================================================================
Write-Header "STEP 1 - Node.js"
Write-Info "Required: >= 22.0.0  (ESM / import support)"

try {
    $nodeVersion = & node --version 2>$null
    if ($nodeVersion) {
        if (Test-Version $nodeVersion "22.0.0") {
            Write-Ok "Node.js $nodeVersion - version OK"
        } else {
            Write-Fail "Node.js $nodeVersion is below required v22.0.0"
            Write-Host ""
            Write-Host "  Please upgrade Node.js to v22 or higher before continuing." -ForegroundColor Yellow
            Write-Host "  Download: https://nodejs.org/en/download" -ForegroundColor Yellow
            Write-Host "  If you use nvm:  nvm install 22  &&  nvm use 22" -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Fail "Node.js not found."
        Write-Host ""
        Write-Host "  Please install Node.js v22 LTS before running this script." -ForegroundColor Yellow
        Write-Host "  Download: https://nodejs.org/en/download" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Fail "Node.js not found."
    Write-Host ""
    Write-Host "  Please install Node.js v22 LTS before running this script." -ForegroundColor Yellow
    Write-Host "  Download: https://nodejs.org/en/download" -ForegroundColor Yellow
    exit 1
}

# -- npm version check --------------------------------------------------------
try {
    $npmVersion = & npm --version 2>$null
    if ($npmVersion) {
        if (Test-Version $npmVersion "8.0.0") {
            Write-Ok "npm v$npmVersion - version OK"
        } else {
            Write-Fail "npm v$npmVersion is below required v8.0.0"
            Write-Host "  Please upgrade npm:  npm install -g npm@latest" -ForegroundColor Yellow
            exit 1
        }
    }
} catch { }

# =============================================================================
# STEP 2 - Ollama (required >= 0.24.0)
# =============================================================================
Write-Header "STEP 2 - Ollama"
Write-Info "Required: >= 0.24.0"

try {
    $ollamaVersion = (& ollama -v).Split(' ')[-1] 2>$null
    if ($ollamaVersion) {
        if (Test-Version $ollamaVersion "0.24.0") {
            Write-Ok "Ollama v$ollamaVersion - version OK"
            Write-Info "To start Ollama, run:  ollama serve"
            Write-Info "Or launch the Ollama app from the Start Menu - it runs in the system tray"
        } else {
            Write-Fail "Ollama v$ollamaVersion is below required v0.24.0"
            Write-Host ""
            Write-Host "  Please upgrade Ollama before continuing." -ForegroundColor Yellow
            Write-Host "  Option 1 - winget:   winget upgrade Ollama.Ollama" -ForegroundColor Yellow
            Write-Host "  Option 2 - download: https://ollama.com/download" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  After upgrading, start Ollama:" -ForegroundColor Yellow
            Write-Host "    ollama serve   OR   launch Ollama from the Start Menu" -ForegroundColor White
            exit 1
        }
    } else {
        Write-Fail "Ollama not found."
        Write-Host ""
        Write-Host "  Please install Ollama before running this script." -ForegroundColor Yellow
        Write-Host "  Option 1 - winget:   winget install Ollama.Ollama" -ForegroundColor Yellow
        Write-Host "  Option 2 - download: https://ollama.com/download" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  After installing, start Ollama:" -ForegroundColor Yellow
        Write-Host "    ollama serve   OR   launch Ollama from the Start Menu" -ForegroundColor White
        exit 1
    }
} catch {
    Write-Fail "Ollama not found."
    Write-Host ""
    Write-Host "  Please install Ollama before running this script." -ForegroundColor Yellow
    Write-Host "  Option 1 - winget:   winget install Ollama.Ollama" -ForegroundColor Yellow
    Write-Host "  Option 2 - download: https://ollama.com/download" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  After installing, start Ollama:" -ForegroundColor Yellow
    Write-Host "    ollama serve   OR   launch Ollama from the Start Menu" -ForegroundColor White
    exit 1
}

# =============================================================================
# STEP 3 - Ollama mode (cloud or local)
# =============================================================================
Write-Header "STEP 3 - Ollama Mode"

Write-Host ""
Write-Host "  AI features (summaries, keywords, tags) - where do you want to run these?" -ForegroundColor White
Write-Host "    [C] Cloud - uses an external API endpoint  (requires API key)" -ForegroundColor White
Write-Host "    [L] Local - uses your local Ollama instance (no API key needed)" -ForegroundColor White
Write-Host ""
Write-Host "  Note: Embeddings always run on local Ollama regardless of this choice." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Enter [C] for Cloud or [L] for Local: " -ForegroundColor Magenta -NoNewline
$ollamaMode = Read-Host

$aiBaseUrl    = ""
$embedBaseUrl = "http://localhost:11434"   # always local

if ($ollamaMode -match '^[Cc]') {
    $aiBaseUrl  = "https://ollama.com"
    $aiApiKey   = "YOUR_API_KEY_HERE"
    $aiModel    = "gpt-oss:120b-cloud"
    $aiComment  = "# !! Add your API key here before starting the server !!"
    Write-Ok "Cloud mode selected - AI_BASE_URL set to https://ollama.com"
    Write-Info "You can change AI_BASE_URL in .env to any OpenAI-compatible endpoint"
} else {
    $aiBaseUrl  = "http://localhost:11434"
    $aiApiKey   = "ollama"
    $aiModel    = "qwen2.5:7b"
    $aiComment  = "# AI_API_KEY is set to 'ollama' for local mode - no key required"
    Write-Ok "Local mode selected - AI_BASE_URL set to localhost:11434"
}
Write-Info "Embeddings: EMBED_BASE_URL always set to localhost:11434"

# =============================================================================
# STEP 4 - Pull embed model (optional)
# =============================================================================
Write-Header "STEP 4 - Ollama Embed Model"

Write-Info "Default embed model: qwen3-embedding:8b"
Write-Info "This model supports English, Traditional Chinese and Cantonese."
Write-Info "Requires Ollama running locally. Download size: ~5GB"

if (Confirm-Step "Pull 'qwen3-embedding:8b' embed model now?") {
    Write-Info "Running: ollama pull qwen3-embedding:8b  (this may take a few minutes...)"
    try {
        & ollama pull qwen3-embedding:8b
        Write-Ok "qwen3-embedding:8b pulled successfully"
    } catch {
        Write-Fail "ollama pull failed: $_"
        Write-Info "You can pull it manually later:  ollama pull qwen3-embedding:8b"
    }
} else {
    Write-Info "Skipped. Pull manually when ready:  ollama pull qwen3-embedding:8b"
}

# -- Pull local AI model (local mode only) ------------------------------------
if (-not ($ollamaMode -match '^[Cc]')) {
    Write-Host ""
    Write-Info "Local AI model: qwen2.5:7b"
    Write-Info "Used for summaries, keywords and tag suggestions. Download size: ~5GB"

    if (Confirm-Step "Pull 'qwen2.5:7b' AI model now?") {
        Write-Info "Running: ollama pull qwen2.5:7b  (this may take a few minutes...)"
        try {
            & ollama pull qwen2.5:7b
            Write-Ok "qwen2.5:7b pulled successfully"
        } catch {
            Write-Fail "ollama pull failed: $_"
            Write-Info "You can pull it manually later:  ollama pull qwen2.5:7b"
        }
    } else {
        Write-Info "Skipped. Pull manually when ready:  ollama pull qwen2.5:7b"
    }
}

# =============================================================================
# STEP 5 - npm install
# =============================================================================
Write-Header "STEP 5 - npm install"

$packageJson = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path $packageJson)) {
    Write-Fail "package.json not found in project root. Cannot run npm install."
    exit 1
}

Write-Info "Running npm install in $ProjectRoot ..."
Push-Location $ProjectRoot
try {
    & npm install
    Write-Ok "npm install completed"
} catch {
    Write-Fail "npm install failed: $_"
    exit 1
} finally {
    Pop-Location
}

# =============================================================================
# STEP 6 - Config files
# =============================================================================
Write-Header "STEP 6 - Config files"

# -- rss-sites.json -----------------------------------------------------------

$rssTemplatePath = Join-Path $ProjectRoot "rss-sites.json.template"
$rssSitesPath    = Join-Path $ProjectRoot "rss-sites.json"

if (Test-Path $rssSitesPath) {
    Write-Skip "rss-sites.json"
} elseif (Test-Path $rssTemplatePath) {
    Copy-Item -Path $rssTemplatePath -Destination $rssSitesPath
    Write-Ok "rss-sites.json copied from rss-sites.json.template"
} else {
    Write-Fail "rss-sites.json.template not found - cannot create rss-sites.json"
    Write-Info "Create rss-sites.json manually in the project root before starting the server."
}

# =============================================================================
# STEP 7 - Server port
# =============================================================================
Write-Header "STEP 7 - Server port"

Write-Host ""
Write-Host "  [?]  Server port (press Enter for default 3000): " -ForegroundColor Magenta -NoNewline
$portInput = Read-Host
if ([string]::IsNullOrWhiteSpace($portInput)) { $portInput = "3000" }
Write-Ok "Server will run on port $portInput"

# =============================================================================
# STEP 8 - .env file
# =============================================================================
Write-Header "STEP 8 - .env file"

$envPath = Join-Path $ProjectRoot ".env"
$writeEnv = $true

if (Test-Path $envPath) {
    Write-Info ".env already exists."
    if (Confirm-Step ".env found. Overwrite it? (existing file will be backed up as .env.backup)") {
        $envBackup = Join-Path $ProjectRoot ".env.backup"
        Copy-Item -Path $envPath -Destination $envBackup -Force
        Remove-Item -Path $envPath -Force
        Write-Ok "Existing .env backed up to .env.backup"
    } else {
        Write-Skip ".env (keeping existing file)"
        $writeEnv = $false
    }
}

if ($writeEnv) {
    $envLines = @(
        "# -----------------------------------------------",
        "# newsLookup Gen2 - Environment Variables",
        "# -----------------------------------------------",
        "",
        "# Server",
        "PORT=$portInput",
        "",
        "# AI features (summaries, keywords, tags)",
        $aiComment
        "AI_MODEL=$aiModel",
        "AI_API_KEY=$aiApiKey",
        "AI_BASE_URL=$aiBaseUrl",
        "",
        "# Local Ollama (embeddings)",
        "EMBED_MODEL=qwen3-embedding:8b",
        "EMBED_BASE_URL=$embedBaseUrl",
        "",
        "# Sites + profiles config",
        "SITES_PATH=./rss-sites.json",
        "PROFILES_PATH=./model-profiles.json"
    )
    $envLines | Set-Content -Path $envPath -Encoding UTF8
    Write-Ok ".env created"
}

# =============================================================================
# FINAL CHECKLIST
# =============================================================================
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  SETUP COMPLETE - Final Checklist" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

try   { $v = & node --version 2>$null;   Write-Ok  "Node.js        $v" }
catch { Write-Fail "Node.js        not detected - restart terminal or install manually" }

try   { $v = & npm --version 2>$null;    Write-Ok  "npm            v$v" }
catch { Write-Fail "npm            not detected" }

try   { $v = & ollama --version 2>$null; Write-Ok  "Ollama         $v" }
catch { Write-Fail "Ollama         not detected - restart terminal or install manually" }

if (Test-Path (Join-Path $ProjectRoot "node_modules")) {
    Write-Ok  "node_modules   folder present"
} else {
    Write-Fail "node_modules   missing - re-run: npm install"
}

if (Test-Path $rssSitesPath) {
    Write-Ok  "rss-sites      rss-sites.json present"
} else {
    Write-Fail "rss-sites      rss-sites.json missing - copy from rss-sites.json.template"
}

if (Test-Path $envPath) {
    Write-Ok  ".env           file present"
} else {
    Write-Fail ".env           missing"
}

Write-Ok  "port           $portInput"

Write-Host ""
Write-Host "-------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  ACTION REQUIRED BEFORE STARTING THE SERVER:" -ForegroundColor Yellow
Write-Host ""

$stepNum = 1

if ($ollamaMode -match '^[Cc]') {
    Write-Host "  $stepNum. Open .env and replace YOUR_API_KEY_HERE with your real API key" -ForegroundColor Yellow
    Write-Host "       (AI_API_KEY= line)" -ForegroundColor White
    Write-Host ""
    $stepNum++
}

Write-Host "  $stepNum. Make sure Ollama is running before starting the server:" -ForegroundColor Yellow
Write-Host "       ollama serve" -ForegroundColor White
Write-Host ""
$stepNum++

Write-Host "  $stepNum. Start the server:" -ForegroundColor Yellow
Write-Host "       node server.js" -ForegroundColor White
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
