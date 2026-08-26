param(
    [int]$Port = 8767
)

$ErrorActionPreference = "Stop"
$Root = "C:\pinchbench-grok-build"
$Grok = "$Root\bin\grok.exe"
$Workspace = "$Root\canary\web-search-adapter"

$env:GROK_HOME = "$Root\grok-home"
$env:Path = "$Root\bin;$env:Path"
$env:HTTP_PROXY = "http://127.0.0.1:10090"
$env:HTTPS_PROXY = "http://127.0.0.1:10090"
$env:ALL_PROXY = "http://127.0.0.1:10090"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:RUST_LOG = "error"

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "Current window does not contain OPENROUTER_API_KEY."
}

$Health = Invoke-RestMethod `
    -Method Get `
    -Uri "http://127.0.0.1:$Port/healthz" `
    -TimeoutSec 5

if (-not $Health.ok -or [string]$Health.version -ne "0.1.0") {
    throw "Adapter health check failed."
}
if ([string]$Health.target_model -ne "deepseek/deepseek-v4-pro") {
    throw "Unexpected target model: $($Health.target_model)"
}

Write-Host "PASS: adapter health"
$Health | ConvertTo-Json -Depth 10

Remove-Item -LiteralPath $Workspace -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null

$Prompt = "Use the web_search tool. Find the latest entry on the official Grok Build changelog. Create web_probe.md containing the release version, release date, title, and official source URL. Do not answer from memory."
$QuotedPrompt = '"' + $Prompt.Replace('"','\"') + '"'

$Arguments = @(
    "-p",
    $QuotedPrompt,
    "-m",
    "deepseek-v4-pro-openrouter",
    "--cwd",
    $Workspace,
    "--output-format",
    "json",
    "--yolo"
)

$Process = Start-Process `
    -FilePath $Grok `
    -ArgumentList $Arguments `
    -RedirectStandardOutput "$Workspace\stdout.json" `
    -RedirectStandardError "$Workspace\stderr.txt" `
    -NoNewWindow `
    -Wait `
    -PassThru

Write-Host "Exit=$($Process.ExitCode)"
Write-Host "`n===== STDERR ====="
Get-Content "$Workspace\stderr.txt" -ErrorAction SilentlyContinue
Write-Host "`n===== STDOUT ====="
Get-Content "$Workspace\stdout.json" -ErrorAction SilentlyContinue
Write-Host "`n===== WEB PROBE ====="

if (Test-Path "$Workspace\web_probe.md") {
    Get-Content "$Workspace\web_probe.md"
} else {
    Write-Host "web_probe.md does not exist"
}

if ($Process.ExitCode -ne 0) {
    throw "Canary failed with exit code $($Process.ExitCode)."
}
if (-not (Test-Path "$Workspace\web_probe.md")) {
    throw "Canary returned exit code 0 but web_probe.md was not created."
}
if ((Get-Item -LiteralPath "$Workspace\web_probe.md").Length -eq 0) {
    throw "web_probe.md is empty."
}

Write-Host ""
Write-Host "PASS: Grok Build web-search adapter canary completed."
