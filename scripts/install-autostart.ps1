# Starts the Quiet sync server automatically when you log in.
#
# Writes a shortcut into your own Startup folder, which needs no administrator
# rights and no scheduled task. Run it once; undo it with -Remove.

param([switch]$Remove)

$root     = Split-Path $PSScriptRoot -Parent
$startup  = [Environment]::GetFolderPath('Startup')
$linkPath = Join-Path $startup 'Quiet sync server.lnk'

if ($Remove) {
  if (Test-Path $linkPath) {
    Remove-Item $linkPath
    Write-Host "Removed. The sync server will no longer start at logon."
  } else {
    Write-Host "Nothing to remove; no logon entry was installed."
  }
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
$link  = $shell.CreateShortcut($linkPath)
$link.TargetPath       = (Get-Command pwsh).Source
# serve.ps1 exits immediately if the port is already taken, so a second copy
# can never start.
$link.Arguments        = "-NoProfile -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'serve.ps1')`" -Background"
$link.WorkingDirectory = $root
$link.Description      = 'Starts the Quiet notes sync server'
$link.Save()

Write-Host "Installed. The Quiet sync server will start when you log in."
Write-Host "Shortcut: $linkPath"
Write-Host "Undo with: pwsh -NoProfile -File scripts/install-autostart.ps1 -Remove"
