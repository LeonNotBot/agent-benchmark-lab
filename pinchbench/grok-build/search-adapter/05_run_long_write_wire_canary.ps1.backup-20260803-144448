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
$ExpectedHash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.Text.UTF8Encoding]::new($false).GetBytes($Payload)
    )
).Replace("-","").ToLowerInvariant()

$Prompt = @"
You must use the write tool, not the terminal tool, to create long_write_probe.txt
in the current working directory. The complete file content must be exactly the
payload between BEGIN_PAYLOAD and END_PAYLOAD, including the final newline.
After the write tool succeeds, continue the agent turn and reply with exactly:
LONG_WRITE_ADAPTER_OK

BEGIN_PAYLOAD
$PayloadEND_PAYLOAD
"@

$PromptPath = Join-Path $Workspace "prompt.txt"
[System.IO.File]::WriteAllText($PromptPath,$Prompt,[System.Text.UTF8Encoding]::new($false))

$Stdout = Join-Path $Workspace "stdout.json"
$Stderr = Join-Path $Workspace "stderr.txt"
$BeforeCount = 0
if (Test-Path -LiteralPath $AdapterLog) {
    $BeforeCount = @(Get-Content -LiteralPath $AdapterLog -Encoding UTF8).Count
}

$Arguments = @(
    "--prompt-file", $PromptPath,
    "-m", "deepseek-v4-pro-openrouter",
    "--cwd", $Workspace,
    "--output-format", "json",
    "--yolo"
)

$Process = Start-Process `
    -FilePath $Grok `
    -ArgumentList $Arguments `
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
if (-not (Test-Path -LiteralPath (Join-Path $Workspace "long_write_probe.txt"))) {
    throw "long_write_probe.txt was not created."
}

$ActualHash = (Get-FileHash -LiteralPath (Join-Path $Workspace "long_write_probe.txt") -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualHash -ne $ExpectedHash) {
    throw "Long-write file SHA256 mismatch. Expected=$ExpectedHash Actual=$ActualHash"
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
    throw "Canary completed, but adapter logs did not prove that the wire-format normalization path was exercised."
}

Write-Host ""
Write-Host "===== NORMALIZATION EVIDENCE ====="
$Normalized | Select-Object -Last 5 | ConvertTo-Json -Depth 20
Write-Host ""
Write-Host "PASS: long-write tool result completed through adapter v0.1.3." -ForegroundColor Green
