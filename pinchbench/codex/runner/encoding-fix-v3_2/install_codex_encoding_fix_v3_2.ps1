param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runner = "$Root\runner\run_pinchbench_codex_windows.py"
$Config = "$Root\codex-home\config.toml"
$Catalog = "$Root\codex-home\models.deepseek-v4-pro.json"
$Patcher = Join-Path $PSScriptRoot "patch_codex_encoding_v3_2.py"

foreach ($RequiredPath in @($Python, $Runner, $Config, $Catalog, $Patcher)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "找不到必要路径：$RequiredPath"
    }
}

& $Python -X utf8 $Patcher `
    --runner $Runner `
    --config $Config `
    --catalog $Catalog

if ($LASTEXITCODE -ne 0) {
    throw "Codex Windows 编码修复 v3.2 安装失败。"
}

& $Python -X utf8 -m py_compile $Runner
if ($LASTEXITCODE -ne 0) {
    throw "修复后的 runner Python 语法检查失败。"
}

Write-Host ""
Write-Host "PASS：Codex Windows 编码修复 v3.2 已安装。" -ForegroundColor Green
Write-Host "下一步重新运行 stable-fix-v3\03_validate_codex_stability.ps1。"
