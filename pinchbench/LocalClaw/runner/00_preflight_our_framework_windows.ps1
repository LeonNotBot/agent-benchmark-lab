param(
    [string]$Root = "C:\pinchbench-our-framework",
    [string]$SourceDir = "C:\pinchbench-our-framework\framework\localclaw-localcoding-dev"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Show-Check([string]$Name, [bool]$Ok, [string]$Detail) {
    $tag = if ($Ok) { "OK" } else { "FAIL" }
    $color = if ($Ok) { "Green" } else { "Red" }
    Write-Host ("[{0}] {1}: {2}" -f $tag, $Name, $Detail) -ForegroundColor $color
}

$Failed = $false
Write-Host "Our Framework Windows environment preflight" -ForegroundColor Cyan
Write-Host ("Root: " + $Root)
Write-Host ("Source: " + $SourceDir)
Write-Host ""

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $NodeCmd) {
    Show-Check "Node" $false "node not found"
    $Failed = $true
} else {
    $NodeText = (& node --version).Trim()
    $m = [regex]::Match($NodeText, '^v(\d+)\.(\d+)\.(\d+)')
    $NodeOk = $false
    if ($m.Success) {
        $major = [int]$m.Groups[1].Value
        $minor = [int]$m.Groups[2].Value
        $NodeOk = (($major -eq 22 -and $minor -ge 21) -or ($major -ge 24))
    }
    Show-Check "Node" $NodeOk ("{0}; benchmark requires Node 22.21+ or Node 24+ so Node can honor proxy env" -f $NodeText)
    if (-not $NodeOk) { $Failed = $true }
}

$PnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if ($null -eq $PnpmCmd) {
    Show-Check "pnpm" $false "pnpm not found; source pins 10.33.0"
    $Failed = $true
} else {
    $PnpmText = (& pnpm --version).Trim()
    $PnpmOk = ($PnpmText -eq "10.33.0")
    Show-Check "pnpm" $PnpmOk $PnpmText
    if (-not $PnpmOk) { $Failed = $true }
}

$Py = Join-Path $Root ".venv\Scripts\python.exe"
$PyOk = Test-Path -LiteralPath $Py
Show-Check "Python venv" $PyOk $Py
if (-not $PyOk) { $Failed = $true }

$PackageJson = Join-Path $SourceDir "package.json"
$SourceOk = Test-Path -LiteralPath $PackageJson
Show-Check "Framework source" $SourceOk $PackageJson
if (-not $SourceOk) { $Failed = $true }

$ServerBundle = Join-Path $SourceDir "dist-server\server.cjs"
$BuildOk = Test-Path -LiteralPath $ServerBundle
Show-Check "Server build" $BuildOk $ServerBundle
if (-not $BuildOk) { $Failed = $true }

$PrivateCandidates = @(
    (Join-Path $SourceDir "node_modules\@lenovo\claude-cli"),
    (Join-Path $SourceDir "packages\sdk\node_modules\@lenovo\claude-cli"),
    (Join-Path $SourceDir "packages\server\node_modules\@lenovo\claude-cli")
)
$PrivateHit = $PrivateCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$PrivateOk = -not [string]::IsNullOrWhiteSpace([string]$PrivateHit)
Show-Check "@lenovo/claude-cli" $PrivateOk ($(if ($PrivateOk) { [string]$PrivateHit } else { "private dependency not installed" }))
if (-not $PrivateOk) { $Failed = $true }

$Runner = Join-Path $Root "runner\03_run_pinchbench_our_framework_windows.py"
$RunnerOk = Test-Path -LiteralPath $Runner
Show-Check "Benchmark runner" $RunnerOk $Runner
if (-not $RunnerOk) { $Failed = $true }

$SkillDir = Join-Path $Root "skill"
$Manifest = Join-Path $SkillDir "tasks\manifest.yaml"
$SkillOk = Test-Path -LiteralPath $Manifest
Show-Check "PinchBench checkout" $SkillOk $Manifest
if (-not $SkillOk) { $Failed = $true }

$Proxy = $env:HTTPS_PROXY
if ([string]::IsNullOrWhiteSpace($Proxy)) { $Proxy = $env:HTTP_PROXY }
$ProxyOk = -not [string]::IsNullOrWhiteSpace($Proxy)
Show-Check "Proxy env" $ProxyOk ($(if ($ProxyOk) { $Proxy } else { "HTTP_PROXY/HTTPS_PROXY missing" }))
if (-not $ProxyOk) { $Failed = $true }

$KeyOk = -not [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)
Show-Check "OPENROUTER_API_KEY" $KeyOk ($(if ($KeyOk) { "set in current PowerShell" } else { "missing" }))
if (-not $KeyOk) { $Failed = $true }

$NodeProxyOk = ($env:NODE_USE_ENV_PROXY -eq "1")
Show-Check "NODE_USE_ENV_PROXY" $NodeProxyOk ($(if ($NodeProxyOk) { "1" } else { "not set to 1" }))
if (-not $NodeProxyOk) { $Failed = $true }

Write-Host ""
if ($Failed) {
    Write-Host "PRECHECK FAILED. Fix the FAIL items before starting the framework server." -ForegroundColor Red
    exit 2
}
Write-Host "PRECHECK PASSED." -ForegroundColor Green
exit 0

