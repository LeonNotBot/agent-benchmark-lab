param(
    [string]$Root = "C:\pinchbench-grok-build",
    [int]$Port = 8767
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Grok = Join-Path $Root "bin\grok.exe"
$Workspace = Join-Path $Root "canary\long-write-adapter-v0.1.3"
$AdapterLog = Join-Path $Root "logs\search-adapter.jsonl"

$env:GROK_HOME = Join-Path $Root "grok-home"
$env:Path = "$(Join-Path $Root 'bin');$env:Path"
$env:HTTP_PROXY = "http://127.0.0.1:10090"
$env:HTTPS_PROXY = "http://127.0.0.1:10090"
$env:ALL_PROXY = "http://127.0.0.1:10090"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:RUST_LOG = "error"

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "Current window does not contain OPENROUTER_API_KEY."
}
if (-not (Test-Path -LiteralPath $Grok)) {
    throw "grok.exe not found: $Grok"
}

$Health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 5
if (-not $Health.ok -or [string]$Health.version -ne "0.1.3") {
    throw "Expected adapter v0.1.3, actual health: $($Health | ConvertTo-Json -Compress)"
}

Remove-Item -LiteralPath $Workspace -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null

$Line = "GROK_LONG_WRITE_WIRE_PROBE_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
$PayloadLines = 1..280 | ForEach-Object { "{0:D3}:{1}" -f $_,$Line }
$Payload = ($PayloadLines -join "`n") + "`n"

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$ExpectedHash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        $Utf8NoBom.GetBytes($Payload)
    )
).Replace("-","").ToLowerInvariant()

$Header = @"
You must use the write tool, not the terminal tool, to create long_write_probe.txt
in the current working directory. The complete file content must be exactly the
payload between BEGIN_PAYLOAD and END_PAYLOAD, including the final newline.
After the write tool succeeds, continue the agent turn and reply with exactly:
LONG_WRITE_ADAPTER_OK
"@

# Build by concatenation. Do not use "$PayloadEND_PAYLOAD": PowerShell would
# interpret that as one variable named PayloadEND_PAYLOAD.
$Prompt = $Header.TrimEnd("`r","`n") + "`n`nBEGIN_PAYLOAD`n" + $Payload + "END_PAYLOAD`n"

$PromptPath = Join-Path $Workspace "prompt.txt"
[System.IO.File]::WriteAllText($PromptPath,$Prompt,$Utf8NoBom)

# Local preflight: fail before invoking Grok if the canary payload was corrupted.
$PromptBytes = [System.IO.File]::ReadAllBytes($PromptPath)
$PromptRoundTrip = $Utf8NoBom.GetString($PromptBytes)
$ExpectedSuffix = "BEGIN_PAYLOAD`n" + $Payload + "END_PAYLOAD`n"

if (-not $PromptRoundTrip.EndsWith($ExpectedSuffix,[System.StringComparison]::Ordinal)) {
    throw "Local canary prompt construction failed: payload or END_PAYLOAD marker missing."
}
if ($PromptRoundTrip.IndexOf("001:$Line",[System.StringComparison]::Ordinal) -lt 0) {
    throw "Local canary prompt construction failed: first payload line missing."
}
if ($PromptRoundTrip.IndexOf("280:$Line",[System.StringComparison]::Ordinal) -lt 0) {
    throw "Local canary prompt construction failed: final payload line missing."
}

Write-Host "PASS: local prompt preflight"
Write-Host "Prompt bytes : $($PromptBytes.Length)"
Write-Host "Payload bytes: $($Utf8NoBom.GetByteCount($Payload))"
Write-Host "Expected file SHA256: $ExpectedHash"

$Stdout = Join-Path $Workspace "stdout.json"
$Stderr = Join-Path $Workspace "stderr.txt"
$BeforeCount = 0
if (Test-Path -LiteralPath $AdapterLog) {
    $BeforeCount = @(Get-Content -LiteralPath $AdapterLog -Encoding UTF8).Count
}

$ProcessArguments = @(
    "--prompt-file", $PromptPath,
    "-m", "deepseek-v4-pro-openrouter",
    "--cwd", $Workspace,
    "--output-format", "json",
    "--yolo"
)

$Process = Start-Process `
    -FilePath $Grok `
    -ArgumentList $ProcessArguments `
    -RedirectStandardOutput $Stdout `
    -RedirectStandardError $Stderr `
    -NoNewWindow `
    -Wait `
    -PassThru

Write-Host "Exit=$($Process.ExitCode)"
Write-Host "`n===== STDERR ====="
Get-Content -LiteralPath $Stderr -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
Write-Host "`n===== STDOUT ====="
Get-Content -LiteralPath $Stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue

if ($Process.ExitCode -ne 0) {
    throw "Long-write canary failed with exit code $($Process.ExitCode)."
}

$Output = Get-Content -LiteralPath $Stdout -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$Output.text -notmatch "LONG_WRITE_ADAPTER_OK") {
    throw "Final marker missing from Grok output."
}

$Probe = Join-Path $Workspace "long_write_probe.txt"
if (-not (Test-Path -LiteralPath $Probe)) {
    throw "long_write_probe.txt was not created."
}

$ActualHash = (Get-FileHash -LiteralPath $Probe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualHash -ne $ExpectedHash) {
    $ActualLength = (Get-Item -LiteralPath $Probe).Length
    throw "Long-write file mismatch. ExpectedSHA256=$ExpectedHash ActualSHA256=$ActualHash ActualBytes=$ActualLength"
}

$PositiveModels = @(
    $Output.modelUsage.PSObject.Properties |
        Where-Object {
            ([int64]$_.Value.inputTokens + [int64]$_.Value.outputTokens + [int64]$_.Value.cacheReadInputTokens) -gt 0
        } |
        ForEach-Object { $_.Name }
)
if ($PositiveModels.Count -ne 1 -or $PositiveModels[0] -ne "deepseek/deepseek-v4-pro") {
    throw "Unexpected positive-usage models: $($PositiveModels -join ', ')"
}

$NewLogRows = @()
if (Test-Path -LiteralPath $AdapterLog) {
    $AllRows = @(Get-Content -LiteralPath $AdapterLog -Encoding UTF8)
    if ($AllRows.Count -gt $BeforeCount) {
        $NewLogRows = $AllRows[$BeforeCount..($AllRows.Count-1)] |
            ForEach-Object { try { $_ | ConvertFrom-Json } catch {} }
    }
}

$Normalized = @(
    $NewLogRows |
        Where-Object {
            $_.event -eq "request_wire_format_normalized" -and
            (
                [int]$_.input_nested_arrays_flattened -gt 0 -or
                [int]$_.tool_outputs_stringified -gt 0 -or
                [int]$_.tool_arguments_stringified -gt 0
            )
        }
)

if ($Normalized.Count -eq 0) {
    throw "File and turn completed, but adapter logs did not prove that wire-format normalization was exercised."
}

Write-Host ""
Write-Host "===== NORMALIZATION EVIDENCE ====="
$Normalized | Select-Object -Last 5 | ConvertTo-Json -Depth 20
Write-Host ""
Write-Host "PASS: long-write tool result completed through adapter v0.1.3." -ForegroundColor Green
