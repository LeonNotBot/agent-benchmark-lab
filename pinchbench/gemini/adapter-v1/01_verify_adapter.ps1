param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Adapter = Join-Path $PSScriptRoot "gemini_openrouter_adapter.py"
$Tests = Join-Path $PSScriptRoot "test_adapter.py"
$Gemini = Join-Path $Root "cli\node_modules\.bin\gemini.cmd"
$GeminiHome = Join-Path $Root "gemini-home"
$SettingsPath = Join-Path $GeminiHome ".gemini\settings.json"
$Logs = Join-Path $Root "logs\adapter-v1"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($Required in @($Python, $Adapter, $Tests, $Gemini, $SettingsPath)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw @"
OPENROUTER_API_KEY is missing in this PowerShell window.
Load the existing key before starting the adapter.
"@
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

# Keep the installed Gemini CLI on explicit API-key auth. The local adapter
# accepts a non-secret placeholder key with the expected shape.
$Settings = (
    [System.IO.File]::ReadAllText($SettingsPath) |
    ConvertFrom-Json
)

if ($null -eq $Settings.security) {
    $Settings | Add-Member `
        -MemberType NoteProperty `
        -Name security `
        -Value ([PSCustomObject]@{})
}

if ($null -eq $Settings.security.auth) {
    $Settings.security | Add-Member `
        -MemberType NoteProperty `
        -Name auth `
        -Value ([PSCustomObject]@{})
}

if ($null -eq $Settings.security.auth.PSObject.Properties["selectedType"]) {
    $Settings.security.auth | Add-Member `
        -MemberType NoteProperty `
        -Name selectedType `
        -Value "gemini-api-key"
}
else {
    $Settings.security.auth.selectedType = "gemini-api-key"
}

[System.IO.File]::WriteAllText(
    $SettingsPath,
    ($Settings | ConvertTo-Json -Depth 30),
    $Utf8NoBom
)

$TestStdout = Join-Path $Logs "unit_tests.stdout.txt"
$TestStderr = Join-Path $Logs "unit_tests.stderr.txt"
Remove-Item `
    -LiteralPath $TestStdout, $TestStderr `
    -Force `
    -ErrorAction SilentlyContinue

$Process = Start-Process `
    -FilePath $Python `
    -ArgumentList @("-X", "utf8", $Tests) `
    -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput $TestStdout `
    -RedirectStandardError $TestStderr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Process.ExitCode -ne 0) {
    Write-Host (Get-Content -LiteralPath $TestStdout -Raw)
    Write-Host (Get-Content -LiteralPath $TestStderr -Raw)
    throw "Adapter unit tests failed with exit code $($Process.ExitCode)."
}

$KeyHeaders = @{
    Authorization = "Bearer $env:OPENROUTER_API_KEY"
}

$ProxyArgs = @{}
if (-not [string]::IsNullOrWhiteSpace($env:HTTPS_PROXY)) {
    $ProxyArgs["Proxy"] = $env:HTTPS_PROXY
}

$KeyInfo = Invoke-RestMethod `
    -Method Get `
    -Uri "https://openrouter.ai/api/v1/key" `
    -Headers $KeyHeaders `
    -TimeoutSec 30 `
    @ProxyArgs

if ($null -eq $KeyInfo.data) {
    throw "OpenRouter key validation returned no data."
}

$State = [ordered]@{
    VerifiedAt = (Get-Date).ToString("o")
    AdapterVersion = (
        & $Python -X utf8 $Adapter --version 2>&1 |
        Out-String
    ).Trim()
    GeminiVersion = (
        & $Gemini --version 2>&1 |
        Out-String
    ).Trim()
    Python = $Python
    ForcedModel = "deepseek/deepseek-v4-pro"
    OpenRouterKeyValidated = $true
    UnitTestsPassed = $true
    AuthSelectedType = "gemini-api-key"
    NextStep = "Run 02_start_adapter.ps1 in a dedicated window."
}

[System.IO.File]::WriteAllText(
    (Join-Path $Logs "install_verification.json"),
    ($State | ConvertTo-Json -Depth 10),
    $Utf8NoBom
)

Write-Host ""
Write-Host "PASS: adapter package verification completed." `
    -ForegroundColor Green
Write-Host ("Adapter: " + $Adapter)
Write-Host ("Unit test log: " + $TestStdout)
Write-Host "Next: run 02_start_adapter.ps1 in window A."
