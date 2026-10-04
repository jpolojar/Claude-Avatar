# Starts the avatar (npm run dev) unless it is already running, waits until it
# answers, and opens it in Edge. Used by the desktop shortcut (see
# create-shortcut.ps1). The servers run in their own minimized console window
# named "Avatar"; closing that window stops them.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:5173"
$timeoutSeconds = 90

function Test-Avatar {
  # /api/health answers once both Vite and the Node server are up.
  try {
    return (Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
  } catch {
    return $false
  }
}

function Show-Error([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "Avatar", "OK", "Error") | Out-Null
}

if (-not (Test-Avatar)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Show-Error "Node.js (npm) ei löydy. Asenna Node.js ja yritä uudelleen."
    exit 1
  }
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k title Avatar && npm run dev" -WorkingDirectory $root -WindowStyle Minimized

  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while (-not (Test-Avatar)) {
    if ((Get-Date) -gt $deadline) {
      Show-Error "Avatar ei käynnistynyt $timeoutSeconds sekunnissa. Katso virheet tehtäväpalkin Avatar-ikkunasta."
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }
}

Start-Process -FilePath "msedge.exe" -ArgumentList "--new-window", $url
