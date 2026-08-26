param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runner = "$Root\runner\run_pinchbench_codex_windows.py"
$StableFix = "$Root\runner\stable-fix-v3"
$Checker = "$StableFix\check_validation_transcripts.py"
$Validation = "$StableFix\03_validate_codex_stability.ps1"
$Patcher = Join-Path $PSScriptRoot `
    "patch_post_completion_transport_recovery_v1.py"

foreach ($RequiredPath in @(
    $Python, $Runner, $Checker, $Validation, $Patcher
)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "找不到必要路径：$RequiredPath"
    }
}

& $Python -X utf8 $Patcher `
    --runner $Runner `
    --checker $Checker `
    --validation-ps1 $Validation

if ($LASTEXITCODE -ne 0) {
    throw "完成后传输恢复补丁安装失败。"
}

& $Python -X utf8 -m py_compile $Runner $Checker
if ($LASTEXITCODE -ne 0) {
    throw "补丁后的 Python 文件语法检查失败。"
}

Write-Host ""
Write-Host "PASS：完成后传输恢复补丁 v1 已安装。" -ForegroundColor Green
Write-Host "它不会重试模型、修改产物、修改 grader 或改变分数。"
Write-Host "下一步运行 selftest_post_completion_transport_recovery.ps1。"
