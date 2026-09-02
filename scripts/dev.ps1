# Launches Quiet in dev mode with a clean Windows PATH.
#
# Two separate things break `pnpm tauri dev` when the PATH is inherited from a
# stale shell or from Git Bash:
#
#   1. cargo goes missing. Rustup registers C:\Users\<you>\.cargo\bin in the
#      user PATH, but a terminal opened before that keeps its old copy, and
#      tauri fails with "cargo metadata ... program not found".
#   2. The link step fails. Git Bash puts /usr/bin first, and /usr/bin/link.exe
#      is GNU coreutils `link` — it shadows the MSVC linker of the same name,
#      so the Rust build dies with "extra operand" or LNK errors.
#
# Rebuilding PATH from the registry fixes both: it is the real Windows PATH,
# with .cargo\bin present and no /usr/bin in sight.

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

Set-Location (Split-Path $PSScriptRoot -Parent)
pnpm tauri dev
