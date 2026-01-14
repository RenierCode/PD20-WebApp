#!/usr/bin/env bash
#
# PD-20 WebApp: Install all dependencies for Linux/Raspberry Pi
#
# Usage:
#   ./deploy/install-all.sh [REPO_DIR]
#   
# Examples:
#   ./deploy/install-all.sh                    (uses current directory)
#   ./deploy/install-all.sh /home/pi/pd-20     (uses specified directory)
#   sudo ./deploy/install-all.sh /opt/pd-20    (with sudo for system-wide install)
#
# This script installs:
#   - System dependencies (Python 3, Node.js, build tools)
#   - Python backend dependencies
#   - Node.js frontend dependencies
#

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
REPO_DIR="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IS_SUDO=false

# Check if running with sudo
if [ "${SUDO_USER:-}" ]; then
  IS_SUDO=true
  ACTUAL_USER="$SUDO_USER"
else
  ACTUAL_USER="$(whoami)"
fi

# Validate repository directory
if [ ! -f "$REPO_DIR/backend/requirements.txt" ] || [ ! -f "$REPO_DIR/frontend/package.json" ]; then
  echo -e "${RED}ERROR: Invalid repository directory: $REPO_DIR${NC}"
  echo "The directory must contain backend/requirements.txt and frontend/package.json"
  exit 1
fi

print_header() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN}  Installing PD-20 WebApp Dependencies${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""
}

print_section() {
  echo -e "${CYAN}[$1/3] $2${NC}"
  echo -e "${CYAN}-----${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ ERROR: $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ WARNING: $1${NC}"
}

# Step 1: Install system dependencies
install_system_deps() {
  print_section "1" "System Dependencies"
  
  # Check if running on Debian/Ubuntu-based system
  if ! command -v apt-get &> /dev/null; then
    print_warning "apt-get not found. Skipping system dependency installation."
    print_warning "Please manually install: git, build-essential, python3, python3-venv, python3-dev, nodejs, npm"
    return 0
  fi
  
  if [ "$IS_SUDO" = false ]; then
    print_warning "Not running with sudo. Skipping system package installation."
    print_warning "To install system packages, run with sudo: sudo ./deploy/install-all.sh"
    return 0
  fi
  
  echo "Updating package lists..."
  apt-get update -qq
  
  echo "Installing system dependencies..."
  apt-get install -y \
    git \
    curl \
    build-essential \
    python3 \
    python3-venv \
    python3-dev \
    libssl-dev \
    libffi-dev 2>/dev/null || true
  
  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    echo "Installing Node.js (v18.x)..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
  else
    NODE_VERSION=$(node --version)
    print_success "Node.js already installed: $NODE_VERSION"
  fi
  
  print_success "System dependencies ready"
  echo ""
}

# Step 2: Setup and install backend dependencies
setup_backend() {
  print_section "2" "Backend Python Dependencies"
  
  BACKEND_DIR="$REPO_DIR/backend"
  VENV_DIR="$BACKEND_DIR/.venv"
  
  if [ ! -f "$BACKEND_DIR/requirements.txt" ]; then
    print_error "requirements.txt not found in $BACKEND_DIR"
    exit 1
  fi
  
  # Create virtual environment if it doesn't exist
  if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
    print_success "Virtual environment created"
  else
    print_success "Using existing virtual environment"
  fi
  
  # Activate venv and install dependencies
  echo "Activating virtual environment..."
  source "$VENV_DIR/bin/activate"
  
  echo "Upgrading pip, setuptools, and wheel..."
  python -m pip install --quiet --upgrade pip setuptools wheel
  
  echo "Installing Python dependencies from requirements.txt..."
  pip install --quiet -r "$BACKEND_DIR/requirements.txt"
  
  # Deactivate venv
  deactivate
  
  print_success "Backend dependencies installed"
  echo ""
}

# Step 3: Setup and install frontend dependencies
setup_frontend() {
  print_section "3" "Frontend Node.js Dependencies"
  
  FRONTEND_DIR="$REPO_DIR/frontend"
  
  if [ ! -f "$FRONTEND_DIR/package.json" ]; then
    print_error "package.json not found in $FRONTEND_DIR"
    exit 1
  fi
  
  # Check if npm is available
  if ! command -v npm &> /dev/null; then
    print_error "npm not found. Please install Node.js and npm first."
    exit 1
  fi
  
  echo "Installing Node.js dependencies from package.json..."
  cd "$FRONTEND_DIR"
  npm install --prefer-offline --no-audit
  cd - > /dev/null
  
  print_success "Frontend dependencies installed"
  echo ""
}

# Main execution
main() {
  print_header
  
  echo "Repository: $REPO_DIR"
  echo "User: $ACTUAL_USER"
  if [ "$IS_SUDO" = true ]; then
    echo "Running with sudo privileges"
  fi
  echo ""
  
  # Run installation steps
  install_system_deps
  setup_backend
  setup_frontend
  
  # Print completion message
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  Installation Complete!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "${CYAN}Next steps:${NC}"
  echo "  Backend:  cd $BACKEND_DIR && source .venv/bin/activate && python main.py"
  echo "  Frontend: cd $FRONTEND_DIR && npm run dev"
  echo ""
}

main "$@"
