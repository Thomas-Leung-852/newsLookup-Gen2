#!/usr/bin/env bash
# =============================================================================
# newsLookup Gen2 - Linux Setup Script
# =============================================================================
# Run from the project root:
#   chmod +x setup-linux.sh
#   ./setup-linux.sh
# =============================================================================

set -euo pipefail

# -- Colours ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m' # No Colour

print_header() { echo -e "\n${CYAN}===  $1  ===${NC}"; }
print_ok()     { echo -e "  ${GREEN}[OK]   $1${NC}"; }
print_skip()   { echo -e "  ${GRAY}[--]   $1 (already installed, skipping)${NC}"; }
print_info()   { echo -e "  ${YELLOW}[..]   $1${NC}"; }
print_fail()   { echo -e "  ${RED}[FAIL] $1${NC}"; }

# -- Helper: yes/no prompt ----------------------------------------------------
confirm_step() {
    echo ""
    echo -e "  ${MAGENTA}[?]  $1 [Y/N]: ${NC}\c"
    read -r ans
    [[ "$ans" =~ ^[Yy]$ ]]
}

# =============================================================================
# BANNER
# =============================================================================
clear
echo ""
echo -e "  ${CYAN}newsLookup Gen2 - Setup Script for Linux${NC}"
echo -e "  ${CYAN}-------------------------------------------------------${NC}"
echo ""

# =============================================================================
# STEP 0 - Confirm project root
# =============================================================================
print_header "STEP 0 - Project Root"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
print_info "Project root: $PROJECT_ROOT"

if [ ! -f "$PROJECT_ROOT/server.js" ]; then
    print_fail "server.js not found in $PROJECT_ROOT"
    echo -e "  ${RED}Please run this script from the newsLookup project root folder.${NC}"
    exit 1
fi
print_ok "server.js found - correct directory confirmed"

# -- Helper: semver compare ---------------------------------------------------
# Usage: version_gte "1.2.3" "1.0.0"  -> returns 0 (true) if $1 >= $2
version_gte() {
    local actual="$1" required="$2"
    actual="${actual#v}"
    required="${required#v}"
    [ "$(printf '%s
%s' "$required" "$actual" | sort -V | tail -n1)" = "$actual" ]
}

# =============================================================================
# STEP 1 - Node.js (required >= 22.0.0 for ESM support)
# =============================================================================
print_header "STEP 1 - Node.js"
print_info "Required: >= 22.0.0  (ESM / import support)"

if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    if version_gte "$NODE_VER" "22.0.0"; then
        print_ok "Node.js $NODE_VER - version OK"
    else
        print_fail "Node.js $NODE_VER is below required v22.0.0"
        echo ""
        echo -e "  ${YELLOW}Please upgrade Node.js to v22 or higher before continuing.${NC}"
        echo -e "  ${YELLOW}Download:       https://nodejs.org/en/download${NC}"
        echo -e "  ${YELLOW}If you use nvm: nvm install 22 && nvm use 22${NC}"
        exit 1
    fi
else
    print_fail "Node.js not found."
    echo ""
    echo -e "  ${YELLOW}Please install Node.js v22 LTS before running this script.${NC}"
    echo -e "  ${YELLOW}Download:       https://nodejs.org/en/download${NC}"
    echo -e "  ${YELLOW}If you use nvm: nvm install 22 && nvm use 22${NC}"
    exit 1
fi

# -- npm version check --------------------------------------------------------
if command -v npm &>/dev/null; then
    NPM_VER=$(npm --version)
    if version_gte "$NPM_VER" "8.0.0"; then
        print_ok "npm v$NPM_VER - version OK"
    else
        print_fail "npm v$NPM_VER is below required v8.0.0"
        echo -e "  ${YELLOW}Please upgrade npm:  npm install -g npm@latest${NC}"
        exit 1
    fi
fi

# =============================================================================
# STEP 2 - Ollama (required >= 0.24.0)
# =============================================================================
print_header "STEP 2 - Ollama"
print_info "Required: >= 0.24.0"

if command -v ollama &>/dev/null; then
    OLLAMA_VER=$(ollama -v | cut -d' ' -f4 2>&1)
    if version_gte "$OLLAMA_VER" "0.24.0"; then
        print_ok "Ollama v$OLLAMA_VER - version OK"
        print_info "Ollama runs as a systemd service on Linux."
        print_info "Start:   sudo systemctl start ollama"
        print_info "Enable auto-start on reboot:  sudo systemctl enable ollama"
    else
        print_fail "Ollama v$OLLAMA_VER is below required v0.24.0"
        echo ""
        echo -e "  ${YELLOW}Please upgrade Ollama before continuing.${NC}"
        echo -e "  ${YELLOW}Option 1 - script:   curl -fsSL https://ollama.com/install.sh | sh${NC}"
        echo -e "  ${YELLOW}Option 2 - download: https://ollama.com/download${NC}"
        echo ""
        echo -e "  ${YELLOW}After upgrading, start Ollama:${NC}"
        echo -e "  ${WHITE}  sudo systemctl start ollama${NC}"
        echo -e "  ${WHITE}  sudo systemctl enable ollama   # auto-start on reboot${NC}"
        exit 1
    fi
else
    print_fail "Ollama not found."
    echo ""
    echo -e "  ${YELLOW}Please install Ollama before running this script.${NC}"
    echo -e "  ${YELLOW}Option 1 - script:   curl -fsSL https://ollama.com/install.sh | sh${NC}"
    echo -e "  ${YELLOW}Option 2 - download: https://ollama.com/download${NC}"
    echo ""
    echo -e "  ${YELLOW}After installing, start Ollama:${NC}"
    echo -e "  ${WHITE}  sudo systemctl start ollama${NC}"
    echo -e "  ${WHITE}  sudo systemctl enable ollama   # auto-start on reboot${NC}"
    exit 1
fi

# =============================================================================
# STEP 3 - Ollama mode (cloud or local)
# =============================================================================
print_header "STEP 3 - Ollama Mode"

echo ""
echo -e "  ${WHITE}AI features (summaries, keywords, tags) - where do you want to run these?${NC}"
echo -e "  ${WHITE}  [C] Cloud - uses an external API endpoint  (requires API key)${NC}"
echo -e "  ${WHITE}  [L] Local - uses your local Ollama instance (no API key needed)${NC}"
echo ""
echo -e "  ${GRAY}Note: Embeddings always run on local Ollama regardless of this choice.${NC}"
echo ""
echo -e "  ${MAGENTA}Enter [C] for Cloud or [L] for Local: ${NC}\c"
read -r OLLAMA_MODE

EMBED_BASE_URL="http://localhost:11434"   # always local

if [[ "$OLLAMA_MODE" =~ ^[Cc]$ ]]; then
    AI_BASE_URL="https://ollama.com"
    AI_API_KEY="YOUR_API_KEY_HERE"
    AI_MODEL="gpt-oss:120b-cloud"
    AI_COMMENT="# !! Add your API key here before starting the server !!"
    print_ok "Cloud mode selected - AI_BASE_URL set to https://ollama.com"
    print_info "You can change AI_BASE_URL in .env to any OpenAI-compatible endpoint"
else
    AI_BASE_URL="http://localhost:11434"
    AI_API_KEY="ollama"
    AI_MODEL="qwen2.5:7b"
    AI_COMMENT="# AI_API_KEY is set to 'ollama' for local mode - no key required"
    print_ok "Local mode selected - AI_BASE_URL set to localhost:11434"
fi
print_info "Embeddings: EMBED_BASE_URL always set to localhost:11434"

# =============================================================================
# STEP 4 - Pull embed model (optional)
# =============================================================================
print_header "STEP 4 - Ollama Embed Model"

print_info "Default embed model: qwen3-embedding:8b"
print_info "This model supports English, Traditional Chinese and Cantonese."
print_info "Requires Ollama running locally. Download size: ~5GB"

if confirm_step "Pull 'qwen3-embedding:8b' embed model now?"; then
    print_info "Running: ollama pull qwen3-embedding:8b  (this may take a few minutes...)"
    if ollama pull qwen3-embedding:8b; then
        print_ok "qwen3-embedding:8b pulled successfully"
    else
        print_fail "ollama pull failed"
        print_info "You can pull it manually later:  ollama pull qwen3-embedding:8b"
    fi
else
    print_info "Skipped. Pull manually when ready:  ollama pull qwen3-embedding:8b"
fi

# -- Pull local AI model (local mode only) ------------------------------------
if [[ ! "$OLLAMA_MODE" =~ ^[Cc]$ ]]; then
    echo ""
    print_info "Local AI model: qwen2.5:7b"
    print_info "Used for summaries, keywords and tag suggestions. Download size: ~5GB"

    if confirm_step "Pull 'qwen2.5:7b' AI model now?"; then
        print_info "Running: ollama pull qwen2.5:7b  (this may take a few minutes...)"
        if ollama pull qwen2.5:7b; then
            print_ok "qwen2.5:7b pulled successfully"
        else
            print_fail "ollama pull failed"
            print_info "You can pull it manually later:  ollama pull qwen2.5:7b"
        fi
    else
        print_info "Skipped. Pull manually when ready:  ollama pull qwen2.5:7b"
    fi
fi

# =============================================================================
# STEP 5 - npm install
# =============================================================================
print_header "STEP 5 - npm install"

if [ ! -f "$PROJECT_ROOT/package.json" ]; then
    print_fail "package.json not found in project root. Cannot run npm install."
    exit 1
fi

print_info "Running npm install in $PROJECT_ROOT ..."
cd "$PROJECT_ROOT"
if npm install; then
    print_ok "npm install completed"
else
    print_fail "npm install failed"
    exit 1
fi

# =============================================================================
# STEP 6 - Config files
# =============================================================================
print_header "STEP 6 - Config files"

# -- rss-sites.json -----------------------------------------------------------

RSS_TEMPLATE_PATH="$PROJECT_ROOT/rss-sites.json.template"
RSS_SITES_PATH="$PROJECT_ROOT/rss-sites.json"

if [ -f "$RSS_SITES_PATH" ]; then
    print_skip "rss-sites.json"
elif [ -f "$RSS_TEMPLATE_PATH" ]; then
    cp "$RSS_TEMPLATE_PATH" "$RSS_SITES_PATH"
    print_ok "rss-sites.json copied from rss-sites.json.template"
else
    print_fail "rss-sites.json.template not found - cannot create rss-sites.json"
    print_info "Create rss-sites.json manually in the project root before starting the server."
fi

# =============================================================================
# STEP 7 - Server port
# =============================================================================
print_header "STEP 7 - Server port"

echo ""
echo -e "  ${MAGENTA}[?]  Server port (press Enter for default 3000): ${NC}\c"
read -r PORT_INPUT
if [ -z "$PORT_INPUT" ]; then PORT_INPUT="3000"; fi
print_ok "Server will run on port $PORT_INPUT"

echo ""
print_info "If your firewall is active, allow this port:"
echo -e "  ${YELLOW}sudo ufw allow ${PORT_INPUT}/tcp${NC}"
echo -e "  ${YELLOW}sudo ufw reload${NC}"

# =============================================================================
# STEP 8 - .env file
# =============================================================================
print_header "STEP 8 - .env file"

ENV_PATH="$PROJECT_ROOT/.env"
WRITE_ENV=true

if [ -f "$ENV_PATH" ]; then
    print_info ".env already exists."
    if confirm_step ".env found. Overwrite it? (existing file will be backed up as .env.backup)"; then
        cp "$ENV_PATH" "$PROJECT_ROOT/.env.backup"
        rm "$ENV_PATH"
        print_ok "Existing .env backed up to .env.backup"
    else
        print_skip ".env (keeping existing file)"
        WRITE_ENV=false
    fi
fi

if [ "$WRITE_ENV" = true ]; then
    cat > "$ENV_PATH" << EOF
# -----------------------------------------------
# newsLookup Gen2 - Environment Variables
# -----------------------------------------------

# Server
PORT=$PORT_INPUT

# AI features (summaries, keywords, tags)
$AI_COMMENT
AI_MODEL=$AI_MODEL
AI_API_KEY=$AI_API_KEY
AI_BASE_URL=$AI_BASE_URL

# Local Ollama (embeddings)
EMBED_MODEL=qwen3-embedding:8b
EMBED_BASE_URL=$EMBED_BASE_URL

# Sites + profiles config
SITES_PATH=./rss-sites.json
PROFILES_PATH=./model-profiles.json
EOF
    print_ok ".env created"
fi

# =============================================================================
# FINAL CHECKLIST
# =============================================================================
echo ""
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}  SETUP COMPLETE - Final Checklist${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

if command -v node &>/dev/null; then
    print_ok "Node.js        $(node --version)"
else
    print_fail "Node.js        not detected - install manually"
fi

if command -v npm &>/dev/null; then
    print_ok "npm            v$(npm --version)"
else
    print_fail "npm            not detected"
fi

if command -v ollama &>/dev/null; then
    print_ok "Ollama         $(ollama --version 2>&1)"
else
    print_fail "Ollama         not detected - install manually"
fi

if [ -d "$PROJECT_ROOT/node_modules" ]; then
    print_ok "node_modules   folder present"
else
    print_fail "node_modules   missing - re-run: npm install"
fi

if [ -f "$RSS_SITES_PATH" ]; then
    print_ok "rss-sites      rss-sites.json present"
else
    print_fail "rss-sites      rss-sites.json missing - copy from rss-sites.json.template"
fi

if [ -f "$ENV_PATH" ]; then
    print_ok ".env           file present"
else
    print_fail ".env           missing"
fi

print_ok "port           $PORT_INPUT"

echo ""
echo -e "${GRAY}-------------------------------------------------------${NC}"
echo -e "${YELLOW}  ACTION REQUIRED BEFORE STARTING THE SERVER:${NC}"
echo ""

STEP_NUM=1

if [[ "$OLLAMA_MODE" =~ ^[Cc]$ ]]; then
    echo -e "  ${YELLOW}$STEP_NUM. Open .env and replace YOUR_API_KEY_HERE with your real API key${NC}"
    echo -e "     ${WHITE}(AI_API_KEY= line)${NC}"
    echo ""
    STEP_NUM=$((STEP_NUM + 1))
fi

echo -e "  ${YELLOW}$STEP_NUM. Make sure Ollama is running before starting the server:${NC}"
echo -e "     ${WHITE}sudo systemctl start ollama${NC}"
echo -e "     ${WHITE}sudo systemctl enable ollama   # auto-start on reboot${NC}"
echo ""
STEP_NUM=$((STEP_NUM + 1))

echo -e "  ${YELLOW}$STEP_NUM. Start the server:${NC}"
echo -e "     ${WHITE}node server.js${NC}"
echo ""
echo -e "${CYAN}=======================================================${NC}"
echo ""
