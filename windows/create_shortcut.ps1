$windowsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $windowsDir) { $windowsDir = (Get-Location).Path }
$rootDir = Split-Path -Parent $windowsDir
if (-not $rootDir) { $rootDir = $windowsDir }

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut((Join-Path $windowsDir "Hermes Settings Windows.lnk"))
$sc.TargetPath = (Join-Path $windowsDir "Hermes Settings Windows.bat")
$sc.WorkingDirectory = $rootDir
$sc.IconLocation = (Join-Path $rootDir "assets\hermes_icon.ico")
$sc.Description = "Hermes Agent Settings & Control Deck"
$sc.Save()
Write-Host "Created 'Hermes Settings Windows.lnk' with icon in windows/"
