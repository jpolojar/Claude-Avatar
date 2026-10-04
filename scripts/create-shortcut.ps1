# Creates "Avatar.lnk" in the project folder: a shortcut that runs
# start-avatar.ps1 with the avatar icon. Copy it to the desktop.
#   powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1

$root = Split-Path -Parent $PSScriptRoot
$shortcutPath = Join-Path $root "Avatar.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $root 'scripts\start-avatar.ps1')`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$(Join-Path $root 'assets\avatar.ico'),0"
$shortcut.Description = "Käynnistä puhuva avatar ja avaa se Edgessä"
$shortcut.WindowStyle = 7 # minimized: no console flash
$shortcut.Save()

Write-Output "Created $shortcutPath"
