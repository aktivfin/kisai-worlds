$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Write-Host "KisAI Worlds installer" -ForegroundColor DarkYellow
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host "Node.js 20+ не найден." -ForegroundColor Red; Write-Host "Установи Node.js LTS с https://nodejs.org и запусти установщик снова."; exit 1 }
$major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 20) { Write-Host "Нужен Node.js 20+; найден Node.js $major." -ForegroundColor Red; exit 1 }
if (-not (Test-Path "$Root\data\config.json")) { Copy-Item "$Root\data\config.example.json" "$Root\data\config.json"; Write-Host "Создан data\config.json" }
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'KisAI Worlds.lnk'
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $Root 'START_WINDOWS.bat'
$shortcut.WorkingDirectory = $Root
$shortcut.Description = 'KisAI Worlds — AI Party RPG'
$shortcut.Save()
Write-Host "Готово. Ярлык создан: $shortcutPath" -ForegroundColor Green
Write-Host "Для LAN-сессии используй START_LAN_WINDOWS.bat"
