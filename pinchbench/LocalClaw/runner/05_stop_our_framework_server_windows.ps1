param([string]$Root = "C:\pinchbench-our-framework", [int]$Port = 10086)
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$RuntimeDir = Join-Path $Root "runtime"
$ConfigDir = Join-Path $Root "config"
$SettingsPath = Join-Path $ConfigDir "settings.json"
$ClaudeJsonPath = Join-Path $ConfigDir ".claude.json"
$GlobalClaudePath = Join-Path $ConfigDir "CLAUDE.md"
$Pids = New-Object System.Collections.Generic.HashSet[int]
$Listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $Listener) { [void]$Pids.Add([int]$Listener.OwningProcess) }
foreach ($Name in @("server.pid","server-launcher.pid")) { $p = Join-Path $RuntimeDir $Name; if (Test-Path -LiteralPath $p) { $v = Get-Content -LiteralPath $p -Raw; $n = 0; if ([int]::TryParse($v.Trim(), [ref]$n)) { [void]$Pids.Add($n) } } }
foreach ($PidValue in $Pids) { & taskkill.exe /PID $PidValue /T /F | Out-Null }
Start-Sleep -Seconds 1
if (Test-Path -LiteralPath $SettingsPath) { try { $s = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json; foreach ($ep in @($s.endpoints)) { if ($null -ne $ep.PSObject.Properties['apiKey']) { $ep.apiKey = "" } }; [System.IO.File]::WriteAllText($SettingsPath,($s | ConvertTo-Json -Depth 30),(New-Object System.Text.UTF8Encoding($false))) } catch {} }
$Claude = [ordered]@{ mcpServers = @{}; mcpServersManaged = @(); hasCompletedOnboarding = $true; bypassPermissionsModeAccepted = $true; hasTrustDialogAccepted = $true }
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
[System.IO.File]::WriteAllText($ClaudeJsonPath,($Claude | ConvertTo-Json -Depth 20),(New-Object System.Text.UTF8Encoding($false)))
if (Test-Path -LiteralPath $GlobalClaudePath) { Remove-Item -LiteralPath $GlobalClaudePath -Force }
foreach ($DirName in @("projects","skills")) { $d = Join-Path $ConfigDir $DirName; if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }
Remove-Item -LiteralPath (Join-Path $RuntimeDir "server.pid") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $RuntimeDir "server-launcher.pid") -Force -ErrorAction SilentlyContinue
Write-Host "OUR FRAMEWORK SERVER STOPPED" -ForegroundColor Green
Write-Host "The OpenRouter key stored in the isolated settings.json has been scrubbed." -ForegroundColor Yellow
