# Stops a previously running Hermes Config Deck started from THIS folder.
#
# A failed in-app update can leave a DETACHED_PROCESS server running with no
# console window. Because it still holds the port, relaunching used to produce
# two decks answering the same address. This script clears that orphan.
#
# It never guesses. The server records its pid in .deck-pid, and every
# candidate is verified before being touched:
#   1. the pid must come from .deck-pid written by this folder's server
#   2. that pid must still be alive
#   3. the process must actually be a Python interpreter
#   4. its command line must reference server.py
# An unrelated Python program can therefore never be a candidate, even if it
# happens to reuse a pid.

$ErrorActionPreference = 'SilentlyContinue'

$root    = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.deck-pid'

if (-not (Test-Path $pidFile)) { exit 0 }

$recorded = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $recorded) { exit 0 }

$deckPid = 0
if (-not [int]::TryParse($recorded.Trim(), [ref]$deckPid) -or $deckPid -le 0) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

if ($deckPid -eq $PID) { exit 0 }

$proc = Get-CimInstance Win32_Process -Filter "ProcessId = $deckPid" -ErrorAction SilentlyContinue
if (-not $proc) {
    # Stale file from a deck that already exited.
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

$name = ''
if ($proc.Name) { $name = $proc.Name.ToLower() }
$cmd = ''
if ($proc.CommandLine) { $cmd = $proc.CommandLine }

if (($name -notlike 'python*') -or ($cmd -notlike '*server.py*')) {
    # The pid was recycled by something unrelated - leave it alone.
    Write-Host "[INFO] Ignoring PID $deckPid (not a Config Deck process)."
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

Write-Host "[INFO] Stopping previous Config Deck (PID $deckPid)..."
Stop-Process -Id $deckPid -Force -ErrorAction SilentlyContinue

# Give the OS a moment to release the listening socket before the new deck binds.
for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-Process -Id $deckPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 100
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "[OK] Previous Config Deck stopped."
