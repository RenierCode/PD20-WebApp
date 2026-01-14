#!/usr/bin/env bash
#
# PD-20 WebApp: Complete Raspberry Pi Setup, Install, and Start Script
#
# This script performs all necessary steps to get the PD-20 WebApp running on Raspberry Pi:
#   1. System setup and dependency installation
#   2. Backend and frontend dependency installation
#   3. Start both backend and frontend services
#
# Usage:
#   sudo ./pi-setup-install-start.sh [REPO_DIR] [SKIP_SETUP]
#   
# Examples:
#   sudo ./pi-setup-install-start.sh                         (interactive mode, uses current dir)
#   sudo ./pi-setup-install-start.sh /home/pi/pd-20          (uses specified directory)
#   sudo ./pi-setup-install-start.sh /home/pi/pd-20 true     (skip system setup)
#
# Requirements:
#   - Run with sudo
#   - Raspberry Pi OS (Debian-based)
#   - Internet connection
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

REPO_DIR="${1:-.}"
SKIP_SETUP="${2:-false}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_DIR="$SCRIPT_DIR"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKGROUND_MODE=true

# ============================================================================
# Functions
# ============================================================================

print_header() {
  echo ""
  echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║    PD-20 WebApp: Pi Setup, Install & Start${NC}                 ${CYAN}║${NC}"
  echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

print_section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}[$1] $2${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_step() {
  echo -e "${CYAN}→ $1${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ ERROR: $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
  echo -e "${CYAN}ℹ $1${NC}"
}

check_sudo() {
  if [ "$(id -u)" -ne 0 ]; then
    print_error "This script must be run with sudo"
    echo "Usage: sudo $0 [REPO_DIR] [SKIP_SETUP]"
    exit 1
  fi
}

validate_repo() {
  if [ ! -f "$REPO_DIR/backend/requirements.txt" ] || [ ! -f "$REPO_DIR/frontend/package.json" ]; then
    print_error "Invalid repository directory: $REPO_DIR"
    print_error "The directory must contain:"
    print_error "  - backend/requirements.txt"
    print_error "  - frontend/package.json"
    exit 1
  fi
  print_success "Repository validated"
}

install_system_deps() {
  print_section "1" "System Setup & Dependencies"
  
  if [ "$SKIP_SETUP" = "true" ]; then
    print_warning "Skipping system setup (SKIP_SETUP=true)"
    return 0
  fi
  
  # Check if running on Debian/Ubuntu-based system
  if ! command -v apt-get &> /dev/null; then
    print_error "apt-get not found. This script requires Debian/Ubuntu-based OS"
    exit 1
  fi
  
  print_step "Updating package lists..."
  apt-get update -qq
  apt-get upgrade -y -qq
  print_success "Package lists updated"
  
  print_step "Installing system dependencies..."
  apt-get install -y -qq \
    git \
    curl \
    wget \
    build-essential \
    python3 \
    python3-venv \
    python3-dev \
    libssl-dev \
    libffi-dev \
    nginx \
    supervisor 2>/dev/null || true
  print_success "System packages installed"
  
  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    print_step "Installing Node.js (v18.x)..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y -qq nodejs
    print_success "Node.js installed"
  else
    NODE_VERSION=$(node --version)
    print_success "Node.js already installed: $NODE_VERSION"
  fi
  
  print_success "System setup completed"
}

install_backend_deps() {
  print_section "2" "Backend Dependencies (Python)"
  
  BACKEND_DIR="$REPO_DIR/backend"
  VENV_DIR="$BACKEND_DIR/.venv"
  
  if [ ! -f "$BACKEND_DIR/requirements.txt" ]; then
    print_error "requirements.txt not found in $BACKEND_DIR"
    exit 1
  fi
  
  # Create virtual environment if it doesn't exist
  if [ ! -d "$VENV_DIR" ]; then
    print_step "Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
    print_success "Virtual environment created"
  else
    print_success "Using existing virtual environment"
  fi
  
  # Activate venv and install dependencies
  print_step "Activating virtual environment..."
  source "$VENV_DIR/bin/activate"
  
  print_step "Upgrading pip, setuptools, and wheel..."
  python -m pip install --quiet --upgrade pip setuptools wheel
  
  print_step "Installing Python dependencies..."
  pip install --quiet -r "$BACKEND_DIR/requirements.txt"
  
  deactivate
  print_success "Backend dependencies installed"
}

install_frontend_deps() {
  print_section "3" "Frontend Dependencies (Node.js)"
  
  FRONTEND_DIR="$REPO_DIR/frontend"
  
  if [ ! -f "$FRONTEND_DIR/package.json" ]; then
    print_error "package.json not found in $FRONTEND_DIR"
    exit 1
  fi
  
  if ! command -v npm &> /dev/null; then
    print_error "npm not found. Please install Node.js first"
    exit 1
  fi
  
  print_step "Installing Node.js dependencies..."
  cd "$FRONTEND_DIR"
  npm install --prefer-offline --no-audit --quiet
  cd - > /dev/null
  
  print_success "Frontend dependencies installed"
}

start_backend() {
  print_section "4" "Starting Backend Service"
  
  BACKEND_DIR="$REPO_DIR/backend"
  VENV_DIR="$BACKEND_DIR/.venv"
  BACKEND_LOG="/var/log/pd20-backend.log"
  
  print_step "Starting backend (FastAPI) on port $BACKEND_PORT..."
  
  if [ "$BACKGROUND_MODE" = true ]; then
    # Create log directory if it doesn't exist
    mkdir -p /var/log
    
    # Start backend in background
    cd "$BACKEND_DIR"
    source "$VENV_DIR/bin/activate"
    
    # Run with nohup to keep it running even if terminal closes
    nohup python main.py > "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    
    deactivate
    cd - > /dev/null
    
    # Give it a moment to start
    sleep 2
    
    if kill -0 $BACKEND_PID 2>/dev/null; then
      print_success "Backend started (PID: $BACKEND_PID)"
      print_info "Logs: tail -f $BACKEND_LOG"
    else
      print_error "Failed to start backend. Check logs: $BACKEND_LOG"
      cat "$BACKEND_LOG" 2>/dev/null || true
      exit 1
    fi
  else
    cd "$BACKEND_DIR"
    source "$VENV_DIR/bin/activate"
    python main.py
  fi
}

start_frontend() {
  print_section "5" "Starting Frontend Service"
  
  FRONTEND_DIR="$REPO_DIR/frontend"
  FRONTEND_LOG="/var/log/pd20-frontend.log"
  
  print_step "Starting frontend (Vite) on port $FRONTEND_PORT..."
  
  if [ "$BACKGROUND_MODE" = true ]; then
    # Create log directory if it doesn't exist
    mkdir -p /var/log
    
    # Start frontend in background
    cd "$FRONTEND_DIR"
    
    # Run with nohup to keep it running even if terminal closes
    nohup npm run dev > "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    
    cd - > /dev/null
    
    # Give it a moment to start
    sleep 3
    
    if kill -0 $FRONTEND_PID 2>/dev/null; then
      print_success "Frontend started (PID: $FRONTEND_PID)"
      print_info "Logs: tail -f $FRONTEND_LOG"
    else
      print_error "Failed to start frontend. Check logs: $FRONTEND_LOG"
      cat "$FRONTEND_LOG" 2>/dev/null || true
      exit 1
    fi
  else
    cd "$FRONTEND_DIR"
    npm run dev
  fi
}

print_completion() {
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║                 Setup Complete!${NC}                             ${GREEN}║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${CYAN}Services running:${NC}"
  echo -e "  ${GREEN}✓${NC} Backend:  http://localhost:$BACKEND_PORT"
  echo -e "  ${GREEN}✓${NC} Frontend: http://localhost:$FRONTEND_PORT"
  echo ""
  echo -e "${CYAN}Useful commands:${NC}"
  echo -e "  Monitor backend:  ${YELLOW}tail -f /var/log/pd20-backend.log${NC}"
  echo -e "  Monitor frontend: ${YELLOW}tail -f /var/log/pd20-frontend.log${NC}"
  echo -e "  Stop backend:     ${YELLOW}pkill -f 'python main.py'${NC}"
  echo -e "  Stop frontend:    ${YELLOW}pkill -f 'npm run dev'${NC}"
  echo -e "  Restart both:     ${YELLOW}sudo $0${NC}"
  echo ""
}

cleanup_on_exit() {
  echo -e "${YELLOW}Shutting down services...${NC}"
  pkill -f "python main.py" 2>/dev/null || true
  pkill -f "npm run dev" 2>/dev/null || true
  print_success "Services stopped"
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
  # Set trap to cleanup on exit
  trap cleanup_on_exit EXIT INT TERM
  
  check_sudo
  print_header
  
  echo -e "${CYAN}Configuration:${NC}"
  echo "  Repository:      $REPO_DIR"
  echo "  Skip Setup:      $SKIP_SETUP"
  echo "  Backend Port:    $BACKEND_PORT"
  echo "  Frontend Port:   $FRONTEND_PORT"
  echo ""
  
  validate_repo
  echo ""
  
  # Install stage
  install_system_deps
  install_backend_deps
  install_frontend_deps
  echo ""
  
  # Start stage
  start_backend
  start_frontend
  echo ""
  
  print_completion
  
  # Keep running (for cleanup trap)
  wait
}

# ============================================================================
# Entry Point
# ============================================================================

main "$@"
