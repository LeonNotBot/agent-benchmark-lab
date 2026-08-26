param(
    [int]$Port = 8767
)

$ErrorActionPreference = "Stop"
$Root = "C:\pinchbench-grok-build"
$env:GROK_HOME = "$Root\grok-home"
$Config = Join-Path $env:GROK_HOME "config.toml"

if (-not (Test-Path -LiteralPath $Config)) {
    throw "Config not found: $Config"
}

$Text = Get-Content -LiteralPath $Config -Raw -Encoding UTF8

$RequiredLines = @(
    '[model.deepseek-v4-pro-openrouter]',
    'model = "deepseek/deepseek-v4-pro"',
    'env_key = "OPENROUTER_API_KEY"',
    'api_backend = "responses"'
)

foreach ($Line in $RequiredLines) {
    if (-not $Text.Contains($Line)) {
        throw "Unexpected config structure. Missing exact line: $Line"
    }
}

$SectionPattern = '(?ms)(\[model\.deepseek-v4-pro-openrouter\]\s*)(.*?)(?=^\[|\z)'
$Match = [regex]::Match($Text, $SectionPattern)
if (-not $Match.Success) {
    throw "Could not locate [model.deepseek-v4-pro-openrouter]."
}

$Body = $Match.Groups[2].Value
$BasePattern = '(?m)^\s*base_url\s*=\s*"[^"]+"\s*$'
$BaseMatches = [regex]::Matches($Body, $BasePattern)

if ($BaseMatches.Count -ne 1) {
    throw "Expected exactly one base_url line in the model section; found $($BaseMatches.Count)."
}

$AdapterBase = "http://127.0.0.1:$Port/v1"
$NewBody = [regex]::Replace(
    $Body,
    $BasePattern,
    ('base_url = "' + $AdapterBase + '"'),
    1
)

$NewText =
    $Text.Substring(0, $Match.Groups[2].Index) +
    $NewBody +
    $Text.Substring($Match.Groups[2].Index + $Match.Groups[2].Length)

$Backup = "$Config.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item -LiteralPath $Config -Destination $Backup -Force
$NewText | Set-Content -LiteralPath $Config -Encoding UTF8

Write-Host "PASS: Grok Build custom model now uses the local adapter."
Write-Host "Config : $Config"
Write-Host "Backup : $Backup"
Write-Host "Base   : $AdapterBase"
Get-Content -LiteralPath $Config
