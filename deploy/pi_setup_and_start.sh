#!/usr/bin/env bash
set -euo pipefail

# PD-20 Remake: Raspberry Pi setup and start script
# Usage: sudo ./pi_setup_and_start.sh [REPO_DIR]
# Example: sudo ./pi_setup_and_start.sh /home/pi/pd-20-remake

REPO_DIR=${1:-/home/pi/pd-20-remake}
USER=${SUDO_USER:-$(whoami)}

echo "Running PD-20 Pi setup for repo at: $REPO_DIR (as user: $USER)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run this script with sudo: sudo $0 [REPO_DIR]"
  exit 1
fi

apt_update() {
  echo "Updating apt packages..."
  apt update && apt upgrade -y
}

install_base_pkgs() {
  echo "Installing base packages..."
  apt install -y git curl build-essential python3-venv python3-dev \
    libssl-dev libffi-dev nginx
}

install_node() {
  echo "Installing Node.js (NodeSource 18.x)..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt install -y nodejs
}

ensure_repo() {
  if [ ! -d "$REPO_DIR" ]; then
    echo "Repository directory $REPO_DIR not found. Cloning from current directory is not automated."
    echo "Please clone your repo into $REPO_DIR before running this script, or pass the path as the first arg."
    exit 1
  fi
}

setup_backend() {
  echo "Setting up backend virtualenv and installing Python deps..."
  pushd "$REPO_DIR/backend" >/dev/null
  python3 -m venv .venv
  . .venv/bin/activate
  python -m pip install --upgrade pip
  if [ -f requirements.txt ]; then
    pip install -r requirements.txt
  else
    echo "backend/requirements.txt not found; please create it."; exit 1
  fi
  deactivate
  popd >/dev/null
}

build_frontend() {
  echo "Building frontend (production)..."
  pushd "$REPO_DIR/frontend" >/dev/null
  # Prefer npm ci for reproducible installs
  npm ci
  npm run build
  popd >/dev/null
}

create_systemd_service() {
  echo "Creating systemd service for backend..."
  SERVICE_FILE=/etc/systemd/system/pd20-backend.service
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=PD-20 Backend (FastAPI)
After=network.target

[Service]
User=$USER
WorkingDirectory=$REPO_DIR/backend
Environment="PATH=$REPO_DIR/backend/.venv/bin"
EnvironmentFile=$REPO_DIR/backend/.env
ExecStart=$REPO_DIR/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable pd20-backend.service
  systemctl restart pd20-backend.service || true
}

create_nginx_site() {
  echo "Creating nginx site to serve frontend and proxy /api to backend..."
  SITE_CONF=/etc/nginx/sites-available/pd20
  cat > "$SITE_CONF" <<EOF
server {
    listen 80;
    server_name _;

    root $REPO_DIR/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

  ln -sf "$SITE_CONF" /etc/nginx/sites-enabled/pd20
  # remove default to avoid conflicts
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl restart nginx
}

final_checks() {
  echo "Final checks:"
  echo "Backend status:"
  systemctl status pd20-backend --no-pager || true
  echo "Nginx status:"
  systemctl status nginx --no-pager || true
  echo "You can browse to the Pi's IP address in a browser to see the frontend."
  echo "API is available at http://127.0.0.1:8000 (internal) and proxied at http://<pi-ip>/api"
}

apt_update
install_base_pkgs
install_node
ensure_repo
setup_backend
build_frontend
create_systemd_service
create_nginx_site
final_checks

echo "Pi setup complete."
