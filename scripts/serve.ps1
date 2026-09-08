# Starts the Quiet sync server, and does nothing if it is already up.
#
# The server is the thing everything else depends on: with it down, both apps
# report "server not running" and no note moves between devices. It has been
# stopped by accident often enough that starting it is worth making dull.
#
# -Background launches it in its own hidden process and returns, which is what
# dev.ps1 and the logon task use. Run it plain and it stays in the foreground,
# where the magic-link output is visible -- which is what you want when signing
# in a new device.

param(
  [switch]$Background,
  [int]$Port = 8787
)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Test-Listening([int]$p) {
  $null -ne (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

if (Test-Listening $Port) {
  Write-Host "Quiet sync server already listening on port $Port."
  exit 0
}

# Same reasoning as dev.ps1: rebuild PATH from the registry so node is found
# even from a stale shell or from Git Bash.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

if ($Background) {
  $logDir = Join-Path $root 'server/data'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Start-Process -FilePath 'node' -ArgumentList 'server/src/index.ts' `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'server.out.log') `
    -RedirectStandardError  (Join-Path $logDir 'server.err.log')

  # Confirm it actually came up rather than assuming; a server that died on
  # startup looks exactly like one that was never asked to start.
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Listening $Port) {
      Write-Host "Quiet sync server started on port $Port."
      exit 0
    }
  }
  Write-Warning "Server did not come up within 10s. See server/data/server.err.log"
  exit 1
}

node server/src/index.ts
