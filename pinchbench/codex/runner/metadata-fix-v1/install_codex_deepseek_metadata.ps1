param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Config = "$Root\codex-home\config.toml"
$CatalogSource = Join-Path $PSScriptRoot "models.deepseek-v4-pro.json"
$CatalogDest = "$Root\codex-home\models.deepseek-v4-pro.json"
$Patcher = Join-Path $PSScriptRoot "patch_codex_metadata_config.py"

foreach ($Path in @($Python, $Config, $CatalogSource, $Patcher)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "找不到必要路径：$Path"
    }
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = "$Config.before-model-metadata-$Stamp.bak"

Copy-Item -LiteralPath $Config -Destination $Backup -Force
Copy-Item -LiteralPath $CatalogSource -Destination $CatalogDest -Force

& $Python -X utf8 $Patcher $Config $CatalogDest
if ($LASTEXITCODE -ne 0) {
    throw "config.toml 补丁失败，退出码：$LASTEXITCODE"
}

Write-Host ""
Write-Host "Codex 模型元数据已安装。" -ForegroundColor Green
Write-Host "Config backup : $Backup"
Write-Host "Catalog       : $CatalogDest"
Write-Host "下一步运行 run_codex_metadata_validation.ps1。"
