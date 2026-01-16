#!/usr/bin/env bash
#
# Start both backend and frontend services for PD20-WebApp
#
# Usage: ./start-services.sh
#

set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_LOG="/tmp/pd20-backend.log"
FRONTEND_LOG="/tmp/pd20-frontend.log"

echo -e "${CYAN}Starting PD20 WebApp Services...${NC}\n"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
        echo -e "${GREEN}✓${NC} Backend stopped"
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
        echo -e "${GREEN}✓${NC} Frontend stopped"
    fi
    exit 0
}

trap cleanup INT TERM EXIT

# Start Backend
echo -e "${CYAN}→ Starting backend...${NC}"

if [ ! -d "$BACKEND_DIR/.venv" ]; then
    echo -e "${RED}✗ Virtual environment not found. Run install first.${NC}"
    exit 1
fi

cd "$BACKEND_DIR" && bash -c "source .venv/bin/activate && python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000" > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
cd "$SCRIPT_DIR"
sleep 2

if kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
    echo -e "  URL: http://127.0.0.1:8000"
    echo -e "  Logs: tail -f $BACKEND_LOG"
else
    echo -e "${RED}✗ Backend failed to start${NC}"
    cat "$BACKEND_LOG"
    exit 1
fi

# Start Frontend
echo -e "\n${CYAN}→ Starting frontend...${NC}"

cd "$FRONTEND_DIR" && npm run dev > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
cd "$SCRIPT_DIR"
sleep 3

if kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"
    echo -e "  URL: http://localhost:5173"
    echo -e "  Logs: tail -f $FRONTEND_LOG"
else
    echo -e "${RED}✗ Frontend failed to start${NC}"
    cat "$FRONTEND_LOG"
    exit 1
fi

# Keep running
echo -e "\n${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Both services are running!                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo -e "\n${CYAN}Press Ctrl+C to stop all services${NC}\n"

wait
