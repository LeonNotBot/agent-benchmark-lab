param(
    [string]$RunDir = "C:\pinchbench-regrades\regrade_20260728_165031",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Script = Join-Path $PSScriptRoot "reset_codex_image_gen.py"

foreach ($Required in @(
    $RunDir,
    $Python,
    $Script
)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

$Out = Join-Path $env:TEMP `
    "pinchbench-image-gen-v1-6-reset.stdout.txt"
$Err = Join-Path $env:TEMP `
    "pinchbench-image-gen-v1-6-reset.stderr.txt"

Remove-Item `
    -LiteralPath $Out, $Err `
    -Force `
    -ErrorAction SilentlyContinue

$Process = Start-Process `
    -FilePath $Python `
    -ArgumentList @(
        "-X", "utf8",
        $Script,
        "--run-dir", $RunDir
    ) `
    -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput $Out `
    -RedirectStandardError $Err `
    -NoNewWindow `
    -Wait `
    -PassThru

if (Test-Path -LiteralPath $Out) {
    Get-Content -LiteralPath $Out -Encoding UTF8
}

if ($Process.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $Err) {
        Get-Content `
            -LiteralPath $Err `
            -Encoding UTF8 `
            -Tail 200
    }
    throw "Codex image-gen reset failed."
}

Write-Host ""
Write-Host (
    "PASS: only Codex/task_image_gen was reset."
) -ForegroundColor Green
