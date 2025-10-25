<#
Install backend Python requirements and frontend npm packages.
Usage:
  - Run from repo root: .\install-all.ps1
  - This script requires PowerShell and npm installed.
#>
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$backendReq = Join-Path $repoRoot "backend\requirements.txt"
$frontendPath = Join-Path $repoRoot "frontend"

# Backend: install into venv if present, otherwise system Python
if (Test-Path $venvPython) {
  Write-Host "Installing backend requirements into venv..." -ForegroundColor Green
  & $venvPython -m pip install -r $backendReq
} else {
  Write-Host "No venv found. Installing backend requirements into system Python..." -ForegroundColor Yellow
  python -m pip install -r $backendReq
}

# Frontend: run npm install
Set-Location -Path $frontendPath
Write-Host "Running npm install in frontend..." -ForegroundColor Green
npm install

Write-Host "All dependencies installed." -ForegroundColor Green
