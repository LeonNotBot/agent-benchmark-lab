param(
    [string]$Root = "C:\pinchbench-gemini"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Gemini = Join-Path $Root "cli\node_modules\.bin\gemini.cmd"
$GeminiHome = Join-Path $Root "gemini-home"
$SettingsPath = Join-Path $GeminiHome ".gemini\settings.json"
$RunDir = Join-Path $Root "canary-runs\adapter-v1_1-text"
$Prompt = Join-Path $RunDir "prompt.txt"
$Stdout = Join-Path $RunDir "stdout.jsonl"
$Stderr = Join-Path $RunDir "stderr.txt"
$BaseUrl = "http://127.0.0.1:8766"

foreach ($Path in @($Gemini, $SettingsPath)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required path not found: $Path"
    }
}

$Health = Invoke-RestMethod `
    -Method Get `
    -Uri "$BaseUrl/healthz" `
    -TimeoutSec 5

if ($Health.ok -ne $true) {
    throw "Adapter health check failed."
}

if ([string]$Health.version -ne "1.1.0") {
    throw "Expected adapter 1.1.0, found $($Health.version)"
}

Remove-Item -LiteralPath $RunDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    $Prompt,
    "Reply with exactly: LOCAL_ADAPTER_TEXT_OK",
    $Utf8NoBom
)

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
    ($Settings | ConvertTo-Json -Depth 20),
    $Utf8NoBom
)

$env:GEMINI_CLI_HOME = $GeminiHome
$env:GEMINI_CLI_TRUST_WORKSPACE = "true"
$env:GEMINI_API_KEY = "AIzaSy" + ("0" * 33)
$env:GOOGLE_GEMINI_BASE_URL = $BaseUrl
$env:GOOGLE_GENAI_API_VERSION = "v1beta"
$env:GOOGLE_GENAI_USE_VERTEXAI = "false"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = "localhost,127.0.0.1,::1"
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"

foreach ($Name in @(
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_GCA",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_VERTEX_BASE_URL"
)) {
    Remove-Item -LiteralPath "Env:\$Name" -ErrorAction SilentlyContinue
}

$Process = Start-Process `
    -FilePath $Gemini `
    -ArgumentList @(
        "--model", "deepseek/deepseek-v4-pro",
        "--output-format", "stream-json",
        "--approval-mode", "yolo",
        "--skip-trust"
    ) `
    -WorkingDirectory $RunDir `
    -RedirectStandardInput $Prompt `
    -RedirectStandardOutput $Stdout `
    -RedirectStandardError $Stderr `
    -NoNewWindow `
    -Wait `
    -PassThru

$Events = @(
    Get-Content -LiteralPath $Stdout |
        ForEach-Object {
            try {
                $_ | ConvertFrom-Json
            }
            catch {
            }
        }
)

$Result = $Events |
    Where-Object { $_.type -eq "result" } |
    Select-Object -Last 1

$AssistantText = (
    $Events |
        Where-Object {
            $_.type -eq "message" -and
            $_.role -eq "assistant"
        } |
        ForEach-Object { [string]$_.content }
) -join ""

$Passed = (
    $Process.ExitCode -eq 0 -and
    $null -ne $Result -and
    [string]$Result.status -eq "success" -and
    $AssistantText.Trim() -eq "LOCAL_ADAPTER_TEXT_OK"
)

Write-Host ""
Write-Host ("ExitCode: " + $Process.ExitCode)
Write-Host ("ResultStatus: " + [string]$Result.status)
Write-Host ("AssistantText: " + $AssistantText.Trim())

if (-not $Passed) {
    Write-Host ("Stdout: " + $Stdout)
    Write-Host ("Stderr: " + $Stderr)
    throw "Text canary failed."
}

Write-Host "PASS: Adapter v1.1 text canary passed." `
    -ForegroundColor Green
