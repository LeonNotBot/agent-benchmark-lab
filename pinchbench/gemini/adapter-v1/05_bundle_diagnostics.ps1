param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$RunDirectory = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ([string]::IsNullOrWhiteSpace($RunDirectory)) {
    $Latest = Get-ChildItem `
        -LiteralPath (Join-Path $Root "canary-runs") `
        -Directory `
        -Filter "gemini_adapter_*" `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $Latest) {
        throw "No canary run directory was found."
    }

    $RunDirectory = $Latest.FullName
}

if (-not (Test-Path -LiteralPath $RunDirectory)) {
    throw "Run directory not found: $RunDirectory"
}

$AdapterLogs = Join-Path $Root "logs\adapter-v1"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $env:TEMP (
    "gemini-adapter-canary-diagnostic-" + $Stamp
)
$Desktop = [Environment]::GetFolderPath("Desktop")
$Zip = Join-Path $Desktop (
    "gemini-adapter-canary-diagnostic-" + $Stamp + ".zip"
)
$ExternalManifest = Join-Path $env:TEMP (
    "gemini-adapter-manifest-" + $Stamp + ".csv"
)

Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
Remove-Item `
    -LiteralPath $ExternalManifest `
    -Force `
    -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$RunDestination = Join-Path $Stage "canary_run"
Copy-Item `
    -LiteralPath $RunDirectory `
    -Destination $RunDestination `
    -Recurse `
    -Force

if (Test-Path -LiteralPath $AdapterLogs) {
    Copy-Item `
        -LiteralPath $AdapterLogs `
        -Destination (Join-Path $Stage "adapter_logs") `
        -Recurse `
        -Force
}

$PackageFiles = @(
    "gemini_openrouter_adapter.py",
    "test_adapter.py",
    "README_CN.md",
    "VERSION.txt",
    "SHA256SUMS.txt"
)

foreach ($Name in $PackageFiles) {
    $Source = Join-Path $PSScriptRoot $Name
    if (Test-Path -LiteralPath $Source) {
        Copy-Item `
            -LiteralPath $Source `
            -Destination (Join-Path $Stage $Name) `
            -Force
    }
}

# Refuse to package known credential files.
$SensitiveFiles = @(
    Get-ChildItem -LiteralPath $Stage -Recurse -File |
        Where-Object {
            $_.Name -ieq "auth.json" -or
            $_.Name -ieq "oauth_creds.json" -or
            $_.Name -ieq ".env"
        }
)

if ($SensitiveFiles.Count -gt 0) {
    throw "Sensitive credential file found in staging directory."
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OpenRouterSecret = [string]$env:OPENROUTER_API_KEY
$GeminiSecret = [string]$env:GEMINI_API_KEY

Get-ChildItem -LiteralPath $Stage -Recurse -File |
    Where-Object {
        @(
            ".txt", ".json", ".jsonl", ".csv",
            ".md", ".yaml", ".yml", ".toml",
            ".py", ".ps1"
        ) -contains $_.Extension.ToLowerInvariant()
    } |
    ForEach-Object {
        try {
            $Text = [System.IO.File]::ReadAllText($_.FullName)
            $Redacted = $Text

            foreach ($Secret in @(
                $OpenRouterSecret,
                $GeminiSecret
            )) {
                if (-not [string]::IsNullOrWhiteSpace($Secret)) {
                    $Redacted = $Redacted.Replace(
                        $Secret,
                        "[REDACTED]"
                    )
                }
            }

            $Redacted = [regex]::Replace(
                $Redacted,
                "sk-or-v1-[A-Za-z0-9_-]{20,}",
                "[REDACTED_OPENROUTER_KEY]"
            )

            $Redacted = [regex]::Replace(
                $Redacted,
                "AIzaSy[A-Za-z0-9_-]{20,}",
                "[REDACTED_GEMINI_KEY]"
            )

            if ($Redacted -ne $Text) {
                [System.IO.File]::WriteAllText(
                    $_.FullName,
                    $Redacted,
                    $Utf8NoBom
                )
            }
        }
        catch {
        }
    }

# Create the manifest outside the staging directory so it can never hash
# itself or be locked while its rows are generated.
$Rows = @(
    Get-ChildItem -LiteralPath $Stage -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            $Hash = Get-FileHash `
                -LiteralPath $_.FullName `
                -Algorithm SHA256

            [PSCustomObject]@{
                File = $_.FullName.Substring(
                    $Stage.TrimEnd("\").Length + 1
                )
                Length = $_.Length
                SHA256 = $Hash.Hash
            }
        }
)

$Rows |
    Export-Csv `
        -LiteralPath $ExternalManifest `
        -NoTypeInformation `
        -Encoding UTF8

Move-Item `
    -LiteralPath $ExternalManifest `
    -Destination (
        Join-Path $Stage "bundle_inventory_sha256.csv"
    ) `
    -Force

Compress-Archive `
    -Path (Join-Path $Stage "*") `
    -DestinationPath $Zip `
    -CompressionLevel Optimal `
    -Force

if (-not (Test-Path -LiteralPath $Zip)) {
    throw "Diagnostic ZIP creation failed."
}

$ZipItem = Get-Item -LiteralPath $Zip
$ZipHash = Get-FileHash -LiteralPath $Zip -Algorithm SHA256

Write-Host ""
Write-Host "DIAGNOSTIC ZIP READY" -ForegroundColor Green
Write-Host ("ZIP: " + $ZipItem.FullName)
Write-Host ("SizeBytes: " + $ZipItem.Length)
Write-Host ("SHA256: " + $ZipHash.Hash)

Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
