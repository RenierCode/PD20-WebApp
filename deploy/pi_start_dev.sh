#!/usr/bin/env bash
set -euo pipefail

# Lightweight dev start script for Pi (non-root). Use when you want a quick dev run.
# Usage: ./pi_start_dev.sh [REPO_DIR]

REPO_DIR=${1:-$HOME/pd-20-remake}

echo "Starting backend (uvicorn) and frontend (vite) for development from: $REPO_DIR"

pushd "$REPO_DIR/backend" >/dev/null
if [ ! -d .venv ]; then
  echo "No virtualenv found in backend/.venv — create one with: python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi
. .venv/bin/activate
echo "Starting backend..."
nohup uvicorn main:app --host 0.0.0.0 --port 8000 &> backend-uvicorn.log &
popd >/dev/null

pushd "$REPO_DIR/frontend" >/dev/null
echo "Installing frontend deps (if needed) and starting Vite dev server..."
npm install --no-audit --no-fund
nohup npm run dev &> frontend-vite.log &
popd >/dev/null

echo "Dev servers started. Logs: $REPO_DIR/backend/backend-uvicorn.log and $REPO_DIR/frontend/frontend-vite.log"
