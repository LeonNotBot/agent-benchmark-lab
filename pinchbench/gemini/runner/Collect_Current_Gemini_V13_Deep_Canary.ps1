param(
    [string]$Root = "C:\pinchbench-gemini"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$CanaryRoot = Join-Path $Root "canary-runs\adapter-v1_3"
$Run = Get-ChildItem -LiteralPath $CanaryRoot -Directory -ErrorAction Stop |
    Where-Object { $_.Name -like "gemini_*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $Run) {
    throw "No v1.3 canary run was found under $CanaryRoot"
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $env:TEMP "gemini_v13_deep_evidence_$Stamp"
$OutputDir = Join-Path $HOME "Downloads"
if (-not (Test-Path -LiteralPath $OutputDir)) {
    $OutputDir = $HOME
}
$Zip = Join-Path $OutputDir "gemini_v13_deep_evidence_$Stamp.zip"

Remove-Item -LiteralPath $Stage, $Zip -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

("Run=" + $Run.FullName) |
    Set-Content -LiteralPath (Join-Path $Stage "README.txt") -Encoding UTF8
("Collected=" + (Get-Date -Format o)) |
    Add-Content -LiteralPath (Join-Path $Stage "README.txt") -Encoding UTF8

foreach ($Name in @(
    "run_config.json",
    "results.json",
    "results.partial.json",
    "progress.jsonl"
)) {
    $Source = Join-Path $Run.FullName $Name
    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination $Stage -Force
    }
}

$TranscriptSource = Join-Path `
    $Run.FullName `
    "transcripts\task_deep_research"
$TranscriptDestination = Join-Path $Stage "task_deep_research"

if (Test-Path -LiteralPath $TranscriptSource) {
    New-Item -ItemType Directory -Path $TranscriptDestination -Force |
        Out-Null

    foreach ($Name in @(
        "turn_01_single.jsonl",
        "turn_01_single.stderr.txt",
        "turn_01_single.prompt.txt",
        "turn_results.json",
        "normalized.jsonl"
    )) {
        $Source = Join-Path $TranscriptSource $Name
        if (Test-Path -LiteralPath $Source) {
            Copy-Item `
                -LiteralPath $Source `
                -Destination $TranscriptDestination `
                -Force
        }
    }
}

$WorkspaceSource = Join-Path `
    $Run.FullName `
    "workspaces\task_deep_research"
$Inventory = Join-Path $Stage "workspace_inventory.txt"

if (Test-Path -LiteralPath $WorkspaceSource) {
    Get-ChildItem -LiteralPath $WorkspaceSource -File -Recurse |
        Where-Object {
            $_.FullName -notmatch "\\(\.git|node_modules|skills|__pycache__)\\"
        } |
        Sort-Object FullName |
        ForEach-Object {
            "{0}`t{1}" -f $_.FullName, $_.Length
        } |
        Set-Content -LiteralPath $Inventory -Encoding UTF8
}
else {
    "WORKSPACE MISSING" |
        Set-Content -LiteralPath $Inventory -Encoding UTF8
}

$ConfigPath = Join-Path $Run.FullName "run_config.json"
$RunStart = $Run.CreationTimeUtc
if (Test-Path -LiteralPath $ConfigPath) {
    try {
        $Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 |
            ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace([string]$Config.created_at)) {
            $RunStart = [DateTimeOffset]::Parse([string]$Config.created_at).UtcDateTime
        }
    }
    catch {
        $RunStart = $Run.CreationTimeUtc
    }
}

$AdapterLog = Join-Path `
    $Root `
    "logs\adapter-v1_3\adapter_requests.jsonl"
$FilteredAdapterLog = Join-Path $Stage "adapter_since_canary.jsonl"

if (Test-Path -LiteralPath $AdapterLog) {
    foreach ($Line in Get-Content -LiteralPath $AdapterLog -Encoding UTF8) {
        try {
            $Record = $Line | ConvertFrom-Json
            $Timestamp = [DateTimeOffset]::Parse(
                [string]$Record.timestamp
            ).UtcDateTime
        }
        catch {
            continue
        }

        if ($Timestamp -ge $RunStart) {
            $Line |
                Add-Content -LiteralPath $FilteredAdapterLog -Encoding UTF8
        }
    }
}

Compress-Archive `
    -Path (Join-Path $Stage "*") `
    -DestinationPath $Zip `
    -Force

if (-not (Test-Path -LiteralPath $Zip)) {
    throw "Evidence ZIP was not created: $Zip"
}

$SizeKB = [math]::Round(
    (Get-Item -LiteralPath $Zip).Length / 1KB,
    1
)

Write-Host "DONE"
Write-Host ("Run: " + $Run.FullName)
Write-Host ("ZIP: " + $Zip)
Write-Host ("Size: " + $SizeKB + " KB")
