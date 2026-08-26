param(
    [string]$Root = "C:\pinchbench-gemini"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$AdapterDir = Join-Path $Root "adapter-v1"
$AdapterLogs = Join-Path $Root "logs\adapter-v1_2"
$LatestRun = Get-ChildItem `
    -LiteralPath (Join-Path $Root "canary-runs") `
    -Directory `
    -Filter "gemini_adapter_v1_2_*" `
    -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $LatestRun) {
    throw "No v1.2 canary run directory was found."
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $env:TEMP ("gemini-adapter-v1_2-diag-" + $Stamp)
$Zip = Join-Path ([Environment]::GetFolderPath("Desktop")) `
    ("gemini-adapter-v1_2-diagnostic-" + $Stamp + ".zip")

Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Copy-Item `
    -LiteralPath $LatestRun.FullName `
    -Destination (Join-Path $Stage "canary_run") `
    -Recurse `
    -Force

if (Test-Path -LiteralPath $AdapterLogs) {
    Copy-Item `
        -LiteralPath $AdapterLogs `
        -Destination (Join-Path $Stage "adapter_logs") `
        -Recurse `
        -Force
}

foreach ($Name in @(
    "gemini_openrouter_adapter.py",
    "test_adapter.py",
    "VERSION.txt",
    "02_start_adapter_v1_2.ps1",
    "03_run_remaining_canaries_v1_2.ps1"
)) {
    $Source = Join-Path $AdapterDir $Name
    if (Test-Path -LiteralPath $Source) {
        Copy-Item `
            -LiteralPath $Source `
            -Destination (Join-Path $Stage $Name) `
            -Force
    }
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Secrets = @(
    [string]$env:OPENROUTER_API_KEY,
    [string]$env:GEMINI_API_KEY
)

Get-ChildItem -LiteralPath $Stage -Recurse -File |
    Where-Object {
        @(
            ".txt", ".json", ".jsonl", ".csv",
            ".md", ".py", ".ps1"
        ) -contains $_.Extension.ToLowerInvariant()
    } |
    ForEach-Object {
        try {
            $Text = [System.IO.File]::ReadAllText($_.FullName)
            $Redacted = $Text

            foreach ($Secret in $Secrets) {
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
                "[REDACTED]"
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

$ManifestTemp = Join-Path $env:TEMP `
    ("gemini-adapter-v1_2-manifest-" + $Stamp + ".csv")
$ManifestTarget = Join-Path $Stage "bundle_inventory_sha256.csv"

Remove-Item `
    -LiteralPath $ManifestTemp, $ManifestTarget `
    -Force `
    -ErrorAction SilentlyContinue

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
        -LiteralPath $ManifestTemp `
        -NoTypeInformation `
        -Encoding UTF8

Move-Item `
    -LiteralPath $ManifestTemp `
    -Destination $ManifestTarget `
    -Force

Compress-Archive `
    -Path (Join-Path $Stage "*") `
    -DestinationPath $Zip `
    -CompressionLevel Optimal `
    -Force

$ZipHash = Get-FileHash -LiteralPath $Zip -Algorithm SHA256

Write-Host ""
Write-Host "DIAGNOSTIC ZIP READY" -ForegroundColor Green
Write-Host ("ZIP: " + $Zip)
Write-Host ("SHA256: " + $ZipHash.Hash)

Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
