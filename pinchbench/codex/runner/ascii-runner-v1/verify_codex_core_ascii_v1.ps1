param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"

$Runner = Join-Path $Root "runner\run_pinchbench_codex_windows.py"
$Config = Join-Path $Root "codex-home\config.toml"
$Catalog = Join-Path $Root "codex-home\models.deepseek-v4-pro.json"

foreach ($Path in @($Python, $Runner, $Config, $Catalog)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required path not found: $Path"
    }
}

& $Python -X utf8 -m py_compile $Runner
if ($LASTEXITCODE -ne 0) {
    throw "Runner syntax check failed."
}

$RunnerText = [System.IO.File]::ReadAllText($Runner)
$ConfigText = [System.IO.File]::ReadAllText($Config)
$CatalogDoc = [System.IO.File]::ReadAllText($Catalog) | ConvertFrom-Json
$Model = @($CatalogDoc.models) |
    Where-Object { $_.slug -eq "deepseek/deepseek-v4-pro" } |
    Select-Object -First 1

if ($RunnerText -notmatch "maybe_recover_post_completion_stream_disconnect") {
    throw "Transport recovery patch missing."
}
if ($RunnerText -notmatch "strict-roundtrip BOM-less Windows ANSI/CP936/GB18030") {
    throw "Encoding fix v3.2 missing."
}
if ($ConfigText -notmatch "PINCHBENCH_WINDOWS_LONG_WRITE_GUARD_V2") {
    throw "Guard V2 missing."
}
if ($null -eq $Model) {
    throw "DeepSeek model metadata missing."
}
if ($null -ne $Model.apply_patch_tool_type) {
    throw "apply_patch_tool_type is not null."
}

Write-Host "PASS: core Python runner and configuration are valid." -ForegroundColor Green
Write-Host "The corrupted stable-fix-v3 PowerShell wrappers are not used."
