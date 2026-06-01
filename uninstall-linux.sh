#!/usr/bin/env bash
# =============================================================================
# newsLookup Gen2 - Linux Uninstall Script
# =============================================================================
# Run from the project root:
#   chmod +x uninstall-linux.sh
#   ./uninstall-linux.sh
# =============================================================================

set -uo pipefail

# -- Colours ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m'

print_header() { echo -e "\n${CYAN}===  $1  ===${NC}"; }
print_ok()     { echo -e "  ${GREEN}[OK]   $1${NC}"; }
print_skip()   { echo -e "  ${GRAY}[--]   $1${NC}"; }
print_info()   { echo -e "  ${YELLOW}[..]   $1${NC}"; }
print_fail()   { echo -e "  ${RED}[FAIL] $1${NC}"; }

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
echo -e "  ${CYAN}newsLookup Gen2 - Uninstall Script for Linux${NC}"
echo -e "  ${CYAN}-------------------------------------------------------${NC}"
echo ""
echo -e "  ${WHITE}This script will:${NC}"
echo -e "  ${WHITE}  1. Stop Ollama service if running${NC}"
echo -e "  ${WHITE}  2. Uninstall Ollama${NC}"
echo -e "  ${WHITE}  3. Optionally delete pulled models (~/.ollama)${NC}"
echo -e "  ${WHITE}  4. Optionally delete project config files${NC}"
echo ""

if ! confirm_step "Continue with uninstall?"; then
    echo ""
    print_skip "Uninstall cancelled."
    exit 0
fi

# =============================================================================
# STEP 1 - Stop Ollama service/process
# =============================================================================
print_header "STEP 1 - Stop Ollama"

# Try systemd service first
if systemctl is-active --quiet ollama 2>/dev/null; then
    if sudo systemctl stop ollama; then
        print_ok "Ollama systemd service stopped"
    else
        print_fail "Failed to stop Ollama service"
    fi
else
    print_skip "Ollama systemd service is not running"
fi

# Kill any remaining ollama processes
if pgrep -x "ollama" > /dev/null 2>&1; then
    if sudo pkill -x ollama; then
        print_ok "Ollama process killed"
    else
        print_fail "Failed to kill Ollama process"
    fi
else
    print_skip "No Ollama process found"
fi

sleep 1

# =============================================================================
# STEP 2 - Uninstall Ollama
# =============================================================================
print_header "STEP 2 - Uninstall Ollama"

if command -v ollama &>/dev/null; then
    # Disable systemd service if exists
    if systemctl list-unit-files ollama.service &>/dev/null 2>&1; then
        sudo systemctl disable ollama 2>/dev/null || true
        print_ok "Ollama systemd service disabled"
    fi

    # Remove binary
    OLLAMA_BIN=$(command -v ollama)
    if [ -f "$OLLAMA_BIN" ]; then
        if sudo rm -f "$OLLAMA_BIN"; then
            print_ok "Ollama binary removed: $OLLAMA_BIN"
        else
            print_fail "Failed to remove Ollama binary: $OLLAMA_BIN"
        fi
    fi

    # Remove systemd service file if present
    if [ -f "/etc/systemd/system/ollama.service" ]; then
        sudo rm -f /etc/systemd/system/ollama.service
        sudo systemctl daemon-reload 2>/dev/null || true
        print_ok "Ollama systemd service file removed"
    fi

    # Remove ollama user if created by installer
    if id "ollama" &>/dev/null; then
        if confirm_step "Remove 'ollama' system user created by installer?"; then
            sudo userdel ollama 2>/dev/null && print_ok "Ollama system user removed" || print_fail "Failed to remove ollama user"
        else
            print_skip "ollama system user kept"
        fi
    fi

    print_ok "Ollama uninstalled"
else
    print_skip "Ollama is not installed"
fi

# =============================================================================
# STEP 3 - Delete pulled models (~/.ollama)
# =============================================================================
print_header "STEP 3 - Pulled Ollama Models"

OLLAMA_MODEL_DIR="$HOME/.ollama"

if [ -d "$OLLAMA_MODEL_DIR" ]; then
    print_info "Found Ollama model folder: $OLLAMA_MODEL_DIR"
    print_info "This contains all pulled models (qwen3-embedding:8b, qwen2.5:7b, etc.)"
    print_info "Deleting this folder will require re-pulling models after reinstall."

    if confirm_step "Delete all pulled Ollama models? ($OLLAMA_MODEL_DIR)"; then
        if rm -rf "$OLLAMA_MODEL_DIR"; then
            print_ok "Ollama model folder deleted: $OLLAMA_MODEL_DIR"
        else
            print_fail "Failed to delete model folder: $OLLAMA_MODEL_DIR"
        fi
    else
        print_skip "Ollama models kept at $OLLAMA_MODEL_DIR"
    fi
else
    print_skip "Ollama model folder not found ($OLLAMA_MODEL_DIR)"
fi

# =============================================================================
# STEP 4 - Delete project config files
# =============================================================================
print_header "STEP 4 - Project Config Files"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
print_info "Project root: $PROJECT_ROOT"
echo ""

# .env
ENV_PATH="$PROJECT_ROOT/.env"
if [ -f "$ENV_PATH" ]; then
    if confirm_step "Delete .env?"; then
        rm -f "$ENV_PATH" && print_ok ".env deleted" || print_fail "Failed to delete .env"
    else
        print_skip ".env kept"
    fi
else
    print_skip ".env not found"
fi

# .env.backup
ENV_BACKUP_PATH="$PROJECT_ROOT/.env.backup"
if [ -f "$ENV_BACKUP_PATH" ]; then
    if confirm_step "Delete .env.backup?"; then
        rm -f "$ENV_BACKUP_PATH" && print_ok ".env.backup deleted" || print_fail "Failed to delete .env.backup"
    else
        print_skip ".env.backup kept"
    fi
else
    print_skip ".env.backup not found"
fi

# rss-sites.json
RSS_SITES_PATH="$PROJECT_ROOT/rss-sites.json"
if [ -f "$RSS_SITES_PATH" ]; then
    if confirm_step "Delete rss-sites.json?"; then
        rm -f "$RSS_SITES_PATH" && print_ok "rss-sites.json deleted" || print_fail "Failed to delete rss-sites.json"
    else
        print_skip "rss-sites.json kept"
    fi
else
    print_skip "rss-sites.json not found"
fi

# node_modules
NODE_MODULES_PATH="$PROJECT_ROOT/node_modules"
if [ -d "$NODE_MODULES_PATH" ]; then
    if confirm_step "Delete node_modules folder?"; then
        if rm -rf "$NODE_MODULES_PATH"; then
            print_ok "node_modules deleted"
        else
            print_fail "Failed to delete node_modules"
        fi
    else
        print_skip "node_modules kept"
    fi
else
    print_skip "node_modules not found"
fi

# =============================================================================
# FINAL REPORT
# =============================================================================
echo ""
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}  UNINSTALL COMPLETE${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

if command -v ollama &>/dev/null; then
    print_fail "Ollama         still detected - may need manual removal"
else
    print_ok  "Ollama         not detected"
fi

if [ -d "$OLLAMA_MODEL_DIR" ]; then
    print_info "Models         $OLLAMA_MODEL_DIR still present (kept)"
else
    print_ok  "Models         removed"
fi

if [ -f "$ENV_PATH" ];          then print_info ".env           still present (kept)"
else                                 print_ok  ".env           removed"; fi

if [ -f "$RSS_SITES_PATH" ];    then print_info "rss-sites      still present (kept)"
else                                 print_ok  "rss-sites      removed"; fi

if [ -d "$NODE_MODULES_PATH" ]; then print_info "node_modules   still present (kept)"
else                                 print_ok  "node_modules   removed"; fi

echo ""
echo -e "  ${GRAY}Note: Node.js was not touched by this script.${NC}"
echo -e "  ${GRAY}To uninstall Node.js, use your package manager:${NC}"
echo -e "  ${GRAY}  sudo apt remove nodejs    (Debian/Ubuntu)${NC}"
echo -e "  ${GRAY}  sudo dnf remove nodejs    (Fedora/RHEL)${NC}"
echo -e "  ${GRAY}  nvm uninstall 22          (if using nvm)${NC}"
echo ""
echo -e "${CYAN}=======================================================${NC}"
echo ""
