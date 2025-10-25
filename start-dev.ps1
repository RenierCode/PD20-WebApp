<#
Start both frontend (Vite) and backend (FastAPI) from one PowerShell command.
Usage: In PowerShell run `.
start-dev.ps1` (you may need to unblock the script first).
#>
param(
  [switch]$InstallDeps
)

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$venvActivate = Join-Path $repoRoot ".venv\Scripts\Activate.ps1"
$backendPath = Join-Path $repoRoot "backend"
$frontendPath = Join-Path $repoRoot "frontend"

function Start-Frontend {
  Set-Location -Path $frontendPath
  Write-Host "Starting frontend (npm run dev)..." -ForegroundColor Cyan
  # Open a new PowerShell window and run the frontend dev server so you can see logs
  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit -Command Set-Location -LiteralPath '$frontendPath'; npm run dev" -WorkingDirectory $frontendPath
}

function Start-Backend {
  Set-Location -Path $backendPath
  Write-Host "Starting backend (uvicorn)..." -ForegroundColor Cyan
  # Use venv python to run uvicorn module
  if (Test-Path $venvPython) {
  # Open a new PowerShell window for the backend using the venv Python
  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit -Command Set-Location -LiteralPath '$backendPath'; & '$venvPython' -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000" -WorkingDirectory $backendPath
  } else {
    Write-Host ".venv python not found. Starting with system python..." -ForegroundColor Yellow
  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit -Command Set-Location -LiteralPath '$backendPath'; python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000" -WorkingDirectory $backendPath
  }
}

# Optionally install backend deps
if ($InstallDeps) {
  if (Test-Path $venvPython) {
    Write-Host "Installing backend requirements into venv..." -ForegroundColor Green
    & $venvPython -m pip install -r (Join-Path $backendPath "requirements.txt")
  } else {
    Write-Host "No venv found. Installing to system Python..." -ForegroundColor Yellow
    python -m pip install -r (Join-Path $backendPath "requirements.txt")
  }
}

# Start both
Start-Frontend
Start-Backend

Write-Host "Both processes started (they run in separate processes)." -ForegroundColor Green
