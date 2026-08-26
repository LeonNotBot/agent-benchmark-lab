param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runner = "$Root\runner\run_pinchbench_codex_windows.py"
$SelfTest = Join-Path $PSScriptRoot `
    "selftest_post_completion_transport_recovery.py"

foreach ($RequiredPath in @($Python, $Runner, $SelfTest)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "找不到必要路径：$RequiredPath"
    }
}

& $Python -X utf8 $SelfTest $Runner
if ($LASTEXITCODE -ne 0) {
    throw "完成后传输恢复自检失败。"
}

Write-Host ""
Write-Host "PASS：完成后传输恢复逻辑自检通过。" -ForegroundColor Green
