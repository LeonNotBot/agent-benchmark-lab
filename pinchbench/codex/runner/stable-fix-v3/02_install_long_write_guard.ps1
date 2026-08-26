param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Config = "$Root\codex-home\config.toml"
$Catalog = "$Root\codex-home\models.deepseek-v4-pro.json"
$Installer = Join-Path $PSScriptRoot "install_long_write_guard.py"

foreach ($RequiredPath in @($Python, $Config, $Catalog, $Installer)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "找不到必要路径：$RequiredPath"
    }
}

& $Python -X utf8 $Installer $Config $Catalog
if ($LASTEXITCODE -ne 0) {
    throw "Windows 长文件 guard 安装失败。"
}

Write-Host ""
Write-Host "PASS：已安装通用 Windows 长命令分块约束。" -ForegroundColor Green
Write-Host "未启用 apply_patch；未修改 PinchBench task prompt 或 grader。"
