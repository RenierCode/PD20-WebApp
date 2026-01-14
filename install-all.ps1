<#
.SYNOPSIS
Install backend Python requirements and frontend npm packages for Windows.

.DESCRIPTION
This script installs all dependencies for both backend and frontend:
- Backend: Python packages from requirements.txt into a virtual environment
- Frontend: Node.js packages from package.json

.USAGE
  Run from repo root: .\install-all.ps1
  Requires: PowerShell 3+, Python 3.8+, Node.js, and npm

.NOTES
  If .venv doesn't exist, the script will create it.
#>

param(
  [switch]$SkipBackend,
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$venvPath = Join-Path $repoRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$venvPip = Join-Path $venvPath "Scripts\pip.exe"
$backendReq = Join-Path $repoRoot "backend\requirements.txt"
$frontendPath = Join-Path $repoRoot "frontend"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installing PD-20 WebApp Dependencies" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Backend Installation
if (-not $SkipBackend) {
  Write-Host "[1/2] Backend Setup" -ForegroundColor Cyan
  Write-Host "-----" -ForegroundColor Cyan
  
  # Create venv if it doesn't exist
  if (-not (Test-Path $venvPath)) {
    Write-Host "Creating Python virtual environment at: $venvPath" -ForegroundColor Yellow
    python -m venv $venvPath
  } else {
    Write-Host "Using existing virtual environment at: $venvPath" -ForegroundColor Green
  }
  
  # Upgrade pip
  Write-Host "Upgrading pip..." -ForegroundColor Yellow
  & $venvPython -m pip install --upgrade pip

  # Install backend requirements
  if (Test-Path $backendReq) {
    Write-Host "Installing backend dependencies from requirements.txt..." -ForegroundColor Yellow
    & $venvPip install -r $backendReq
    Write-Host "Backend dependencies installed successfully." -ForegroundColor Green
  } else {
    Write-Host "ERROR: requirements.txt not found at: $backendReq" -ForegroundColor Red
    exit 1
  }
  
  Write-Host ""
}

# Frontend Installation
if (-not $SkipFrontend) {
  Write-Host "[2/2] Frontend Setup" -ForegroundColor Cyan
  Write-Host "-----" -ForegroundColor Cyan
  
  if (-not (Test-Path $frontendPath)) {
    Write-Host "ERROR: frontend directory not found at: $frontendPath" -ForegroundColor Red
    exit 1
  }
  
  Push-Location -Path $frontendPath
  try {
    Write-Host "Installing frontend dependencies with npm..." -ForegroundColor Yellow
    npm install
    Write-Host "Frontend dependencies installed successfully." -ForegroundColor Green
  }
  finally {
    Pop-Location
  }
  
  Write-Host ""
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "  All dependencies installed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  Backend:  Run '.\.venv\Scripts\Activate.ps1' then 'python backend/main.py'" -ForegroundColor White
Write-Host "  Frontend: Run 'npm run dev' in the frontend directory" -ForegroundColor White
