# PD20-WebApp

This repository contains a React + Vite frontend and a FastAPI backend that reads sensor data from MongoDB. This README explains how to set up the project on Windows (PowerShell) and Linux (bash).

## Prerequisites

- Git
- Node.js (LTS recommended, e.g. 16+ or 18+). npm is required.
- Python 3.10+ (venv recommended)
- pip
- MongoDB accessible to the backend (local or remote connection string)

Files and helper scripts in the repo:
- `install-all.ps1` — PowerShell script to install backend and frontend deps on Windows
- `start-dev.ps1` — PowerShell script to start frontend (Vite) and backend (uvicorn) in separate PowerShell windows

## Environment variables (backend)

The backend uses `pydantic_settings` and reads `.env` in the `backend` folder. Create `backend/.env` and set at least:

```
DATABASE_URL=mongodb://localhost:27017
DB_NAME=sensorDB
```

Replace the `DATABASE_URL` with your MongoDB connection string if using a remote DB.

## Setup & Run (Windows — PowerShell)

Open PowerShell in the repo root (`E:\PD20-WebApp`) and follow either the quick-script route or the manual route.

Quick (use provided scripts):

```powershell
# Optional: unblock scripts on first use
# Unblock-File .\install-all.ps1; Unblock-File .\start-dev.ps1

# Install dependencies (backend -> venv or system python; frontend -> npm)
.\install-all.ps1

# Start both frontend and backend (starts them each in a new PowerShell window)
.\start-dev.ps1

# If you want start-dev to also install backend deps before starting, run:
.\start-dev.ps1 -InstallDeps
```

Manual (step-by-step):

```powershell
# 1. Backend: create and activate venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install Python requirements
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt

# 3. Set environment variables (backend/.env)
# Create backend\.env with DATABASE_URL and optionally DB_NAME

# 4. (Optional) populate DB if a seeder exists
# python backend/populate_db.py

# 5. Start backend (from repo root or from backend folder):
cd backend
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

# 6. Frontend: in a new PowerShell window
cd frontend
npm install
npm run dev
```

Frontend will run via Vite (default port 5173). Backend runs on port 8000 by default.

## Setup & Run (Linux — bash)

Open a terminal in the repo root and run these commands.

Manual steps (Linux/macOS):

```bash
# 1. Backend: create and activate venv
python3 -m venv .venv
source .venv/bin/activate

# 2. Install Python requirements
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt

# 3. Create backend/.env with DATABASE_URL and optionally DB_NAME
# Example:
# echo "DATABASE_URL=mongodb://localhost:27017" > backend/.env
# echo "DB_NAME=sensorDB" >> backend/.env

# 4. (Optional) Seed DB
# python backend/populate_db.py

# 5. Start backend
cd backend
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 &

# 6. Frontend
cd ../frontend
npm install
npm run dev
```

If you prefer, you can run backend and frontend in separate terminal tabs so you can see each log stream.

## Notes and troubleshooting

- Make sure MongoDB is reachable by the `DATABASE_URL` you provide in `backend/.env`.
- If you see CORS errors in the browser, ensure the frontend origin is one of the allowed origins in `backend/main.py` (by default `http://localhost:5173` and `http://localhost:3000`).
- On Windows, you may need to adjust the PowerShell execution policy to run the provided scripts once:

```powershell
# This sets policy for the current process only (safer):
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
```

- If `npm run dev` fails due to Node version, install an LTS Node (16/18/20) or use nvm/nvm-windows to switch.
- If you prefer project-level policies for line endings and to avoid warnings like "LF will be replaced by CRLF", add a `.gitattributes` file and renormalize. Example:

```
*.js text eol=lf
*.jsx text eol=lf
*.css text eol=lf
*.html text eol=lf
*.json text eol=lf
frontend/tailwind.config.js text eol=lf
```

Then run:

```powershell
# from repo root
git add --renormalize .
git status --porcelain
git commit -m "Add .gitattributes and normalize line endings"
```

## Where to look next

- Frontend code: `frontend/src/` (React components and pages)
- Backend code: `backend/` (FastAPI app and models)


DATABASE_URL="mongodb+srv://team20-argus:6Y6EI4YHPIGc38qi@cluster0.zk2khx5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
