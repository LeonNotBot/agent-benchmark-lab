param(
    [string]$Python = "",
    [string]$RunDir = "",
    [int]$RefreshSeconds = 10
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Root = "C:\pinchbench-regrader"
. (Join-Path $Root "common_regrade.ps1")
$ResolvedPython = Resolve-RegradePython -Python $Python

$Arguments = @(
    "-X", "utf8",
    (Join-Path $Root "regrade_pinchbench.py"),
    "--config",
    (Join-Path $Root "regrade_config.json"),
    "status",
    "--watch",
    [string]$RefreshSeconds
)

if (-not [string]::IsNullOrWhiteSpace($RunDir)) {
    $Arguments += @("--run-dir", $RunDir)
}

$OldErrorActionPreference = $ErrorActionPreference
$HasNativePreference = Test-Path `
    Variable:\PSNativeCommandUseErrorActionPreference

if ($HasNativePreference) {
    $OldNativePreference = $PSNativeCommandUseErrorActionPreference
}

try {
    $ErrorActionPreference = "Continue"

    if ($HasNativePreference) {
        $PSNativeCommandUseErrorActionPreference = $false
    }

    & $ResolvedPython @Arguments
    $ExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $OldErrorActionPreference

    if ($HasNativePreference) {
        $PSNativeCommandUseErrorActionPreference = $OldNativePreference
    }
}

exit $ExitCode
