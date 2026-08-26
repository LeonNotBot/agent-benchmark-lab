param(
    [string]$Root = "C:\pinchbench-gemini",
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Gemini = Join-Path $Root "cli\node_modules\.bin\gemini.cmd"
$ProbeDir = Join-Path $Root "probe"
$Logs = Join-Path $Root "logs"
$BaseUrl = "http://127.0.0.1:$Port"
$RequestLog = Join-Path $Logs "20_contract_requests.jsonl"
$CustomOut = Join-Path $Logs "21_contract_custom_model.jsonl"
$CustomErr = Join-Path $Logs "21_contract_custom_model.stderr.txt"
$AliasOut = Join-Path $Logs "22_contract_alias_model.jsonl"
$AliasErr = Join-Path $Logs "22_contract_alias_model.stderr.txt"
$PromptFile = Join-Path $ProbeDir "contract_prompt.txt"

if (-not (Test-Path -LiteralPath $Gemini)) {
    throw "Gemini executable not found: $Gemini"
}

New-Item -ItemType Directory -Force -Path $ProbeDir, $Logs | Out-Null

try {
    $Health = Invoke-RestMethod `
        -Method Get `
        -Uri "$BaseUrl/healthz" `
        -TimeoutSec 5
}
catch {
    throw "Local contract recorder is not running at $BaseUrl"
}

if ($Health.ok -ne $true) {
    throw "Local contract recorder health check failed."
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    $PromptFile,
    "Reply with exactly: LOCAL_CONTRACT_PROBE_OK",
    $Utf8NoBom
)

$env:GEMINI_CLI_HOME = Join-Path $Root "gemini-home"
$env:GEMINI_CLI_TRUST_WORKSPACE = "true"
$env:GEMINI_API_KEY = "local-contract-probe-not-secret"
$env:GOOGLE_GEMINI_BASE_URL = $BaseUrl
$env:GOOGLE_GENAI_API_VERSION = "v1beta"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = "localhost,127.0.0.1,::1"
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"

foreach ($Name in @(
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_VERTEX_BASE_URL"
)) {
    Remove-Item -LiteralPath "Env:\$Name" -ErrorAction SilentlyContinue
}

Remove-Item `
    -LiteralPath $CustomOut, $CustomErr, $AliasOut, $AliasErr `
    -Force `
    -ErrorAction SilentlyContinue

$OldErrorActionPreference = $ErrorActionPreference
$HasNativePreference = Test-Path Variable:\PSNativeCommandUseErrorActionPreference
if ($HasNativePreference) {
    $OldNativePreference = $PSNativeCommandUseErrorActionPreference
}

Push-Location $ProbeDir

try {
    # Gemini CLI writes informational messages such as the YOLO notice to
    # stderr. Windows PowerShell 5.1 converts native stderr to non-terminating
    # ErrorRecord objects. Do not let those records abort the probe.
    $ErrorActionPreference = "Continue"
    if ($HasNativePreference) {
        $PSNativeCommandUseErrorActionPreference = $false
    }

    Write-Host "Probe A: custom backend model id..."

    Get-Content -LiteralPath $PromptFile -Raw |
        & $Gemini `
            --model "deepseek/deepseek-v4-pro" `
            --output-format stream-json `
            --approval-mode yolo `
            --skip-trust `
            2> $CustomErr |
        Tee-Object -FilePath $CustomOut

    $CustomCode = $LASTEXITCODE
    Write-Host ("Probe A exit code: " + $CustomCode)
    Write-Host ("Probe A stderr: " + $CustomErr)

    Write-Host ""
    Write-Host "Probe B: Gemini compatibility alias..."

    Get-Content -LiteralPath $PromptFile -Raw |
        & $Gemini `
            --model "gemini-2.5-flash" `
            --output-format stream-json `
            --approval-mode yolo `
            --skip-trust `
            2> $AliasErr |
        Tee-Object -FilePath $AliasOut

    $AliasCode = $LASTEXITCODE
    Write-Host ("Probe B exit code: " + $AliasCode)
    Write-Host ("Probe B stderr: " + $AliasErr)
}
finally {
    $ErrorActionPreference = $OldErrorActionPreference

    if ($HasNativePreference) {
        $PSNativeCommandUseErrorActionPreference = $OldNativePreference
    }

    Pop-Location
}

if (-not (Test-Path -LiteralPath $RequestLog)) {
    throw @"
No requests were captured.

Check:
$CustomErr
$AliasErr
"@
}

$CapturedLines = @(
    Get-Content `
        -LiteralPath $RequestLog `
        -ErrorAction SilentlyContinue
).Count

if ($CapturedLines -lt 1) {
    throw "The request log exists but contains no captured requests."
}

Write-Host ""
Write-Host "PASS: contract probe requests were captured." `
    -ForegroundColor Green
Write-Host ("Captured request lines: " + $CapturedLines)
Write-Host ("Requests: " + $RequestLog)
Write-Host ("Custom output: " + $CustomOut)
Write-Host ("Alias output: " + $AliasOut)
Write-Host ("Custom exit code: " + $CustomCode)
Write-Host ("Alias exit code: " + $AliasCode)
