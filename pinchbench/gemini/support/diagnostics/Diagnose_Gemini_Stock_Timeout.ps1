param(
    [string]$RunDir = "C:\pinchbench-gemini\runs\gemini_20260731_141410",
    [string]$GeminiRoot = "C:\pinchbench-gemini"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Write-Section {
    param([string]$Title)

    Write-Host ""
    Write-Host ("=" * 100) -ForegroundColor DarkCyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ("=" * 100) -ForegroundColor DarkCyan
}

function Show-TextTail {
    param(
        [string]$Path,
        [int]$Tail = 200
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    Write-Host ""
    Write-Host ("----- " + $Path + " -----") -ForegroundColor Yellow

    try {
        Get-Content `
            -LiteralPath $Path `
            -Encoding UTF8 `
            -Tail $Tail
    }
    catch {
        Write-Host (
            "Unable to read as UTF-8 text: " +
            $_.Exception.Message
        ) -ForegroundColor DarkYellow
    }
}

function Find-TaskObjects {
    param(
        [object]$Value,
        [string]$TaskId
    )

    $Matches = New-Object System.Collections.ArrayList

    function Visit {
        param([object]$Node)

        if ($null -eq $Node) {
            return
        }

        if ($Node -is [System.Collections.IDictionary]) {
            if (
                $Node.Contains("task_id") -and
                [string]$Node["task_id"] -eq $TaskId
            ) {
                [void]$Matches.Add($Node)
            }

            foreach ($Key in $Node.Keys) {
                Visit -Node $Node[$Key]
            }

            return
        }

        if (
            $Node -is [System.Management.Automation.PSCustomObject]
        ) {
            $Properties = $Node.PSObject.Properties

            $TaskProperty = $Properties |
                Where-Object Name -eq "task_id" |
                Select-Object -First 1

            if (
                $null -ne $TaskProperty -and
                [string]$TaskProperty.Value -eq $TaskId
            ) {
                [void]$Matches.Add($Node)
            }

            foreach ($Property in $Properties) {
                Visit -Node $Property.Value
            }

            return
        }

        if (
            $Node -is [System.Collections.IEnumerable] -and
            -not ($Node -is [string])
        ) {
            foreach ($Item in $Node) {
                Visit -Node $Item
            }
        }
    }

    Visit -Node $Value
    return $Matches
}

if (-not (Test-Path -LiteralPath $RunDir -PathType Container)) {
    throw "Run directory not found: $RunDir"
}

$TaskId = "task_stock"
$ResultsPath = Join-Path $RunDir "results.json"
$PartialPath = Join-Path $RunDir "results.partial.json"
$ConfigPath = Join-Path $RunDir "run_config.json"
$TranscriptRoot = Join-Path $RunDir "transcripts"

Write-Section "Gemini task_stock timeout diagnostic"
Write-Host ("Run directory : " + $RunDir)
Write-Host ("Task          : " + $TaskId)
Write-Host "Billing       : none; this script only reads existing files"

Write-Section "Run configuration"

foreach ($Path in @($ConfigPath, $ResultsPath, $PartialPath)) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $Info = Get-Item -LiteralPath $Path
        Write-Host (
            $Info.FullName +
            " | bytes=" +
            $Info.Length +
            " | modified=" +
            $Info.LastWriteTime.ToString("s")
        )
    }
    else {
        Write-Host ("Missing: " + $Path) -ForegroundColor DarkYellow
    }
}

if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
    Write-Host ""
    Write-Host "run_config.json:"
    Get-Content `
        -LiteralPath $ConfigPath `
        -Raw `
        -Encoding UTF8
}

Write-Section "task_stock result objects"

$ResultSources = @($ResultsPath, $PartialPath)

foreach ($Source in $ResultSources) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        continue
    }

    Write-Host ""
    Write-Host ("Source: " + $Source) -ForegroundColor Yellow

    try {
        $Object = Get-Content `
            -LiteralPath $Source `
            -Raw `
            -Encoding UTF8 |
            ConvertFrom-Json

        $Matches = Find-TaskObjects `
            -Value $Object `
            -TaskId $TaskId

        if ($Matches.Count -eq 0) {
            Write-Host "No matching task object found."
        }
        else {
            foreach ($Match in $Matches) {
                $Match |
                    ConvertTo-Json `
                        -Depth 30
            }
        }
    }
    catch {
        Write-Host (
            "JSON read failed: " +
            $_.Exception.Message
        ) -ForegroundColor Red
    }
}

Write-Section "Files and directories associated with task_stock"

$NamedItems = Get-ChildItem `
    -LiteralPath $RunDir `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match "stock" -or
        $_.FullName -match "task_stock"
    } |
    Sort-Object FullName

if ($NamedItems.Count -eq 0) {
    Write-Host "No file or directory name contains stock/task_stock."
}
else {
    foreach ($Item in $NamedItems) {
        $Kind = if ($Item.PSIsContainer) {
            "DIR "
        }
        else {
            "FILE"
        }

        $Size = if ($Item.PSIsContainer) {
            ""
        }
        else {
            " bytes=" + $Item.Length
        }

        Write-Host (
            $Kind +
            " " +
            $Item.FullName +
            $Size
        )
    }
}

Write-Section "Transcript and task-specific text"

$CandidateFiles = New-Object System.Collections.ArrayList

if (Test-Path -LiteralPath $TranscriptRoot -PathType Container) {
    foreach ($File in (
        Get-ChildItem `
            -LiteralPath $TranscriptRoot `
            -Recurse `
            -File `
            -Force `
            -ErrorAction SilentlyContinue
    )) {
        if (
            $File.Name -match "stock" -or
            $File.FullName -match "task_stock"
        ) {
            [void]$CandidateFiles.Add($File)
        }
    }
}

$TextExtensions = @(
    ".txt",
    ".log",
    ".json",
    ".jsonl",
    ".ndjson",
    ".stdout",
    ".stderr"
)

foreach ($File in (
    Get-ChildItem `
        -LiteralPath $RunDir `
        -Recurse `
        -File `
        -Force `
        -ErrorAction SilentlyContinue
)) {
    if ($TextExtensions -notcontains $File.Extension.ToLowerInvariant()) {
        continue
    }

    if ($File.Length -gt 20MB) {
        continue
    }

    try {
        $Hit = Select-String `
            -LiteralPath $File.FullName `
            -Pattern "task_stock" `
            -SimpleMatch `
            -Encoding UTF8 `
            -Quiet

        if ($Hit) {
            [void]$CandidateFiles.Add($File)
        }
    }
    catch {
    }
}

$UniqueCandidates = $CandidateFiles |
    Sort-Object FullName -Unique

if ($UniqueCandidates.Count -eq 0) {
    Write-Host "No task-specific transcript or text file was found."
}
else {
    foreach ($File in $UniqueCandidates) {
        Show-TextTail `
            -Path $File.FullName `
            -Tail 240
    }
}

Write-Section "Signal scan"

$SignalPatterns = @(
    "response.completed",
    "turn.completed",
    "tool_call",
    "tool_result",
    "google_web_search",
    "web_fetch",
    "heartbeat",
    "API Error",
    "429",
    "500",
    "502",
    "503",
    "504",
    "timeout",
    "timed out",
    "connection",
    "disconnect",
    "error"
)

foreach ($File in $UniqueCandidates) {
    if ($File.Length -gt 20MB) {
        continue
    }

    Write-Host ""
    Write-Host ("Signals in: " + $File.FullName) -ForegroundColor Yellow

    foreach ($Pattern in $SignalPatterns) {
        try {
            $Matches = Select-String `
                -LiteralPath $File.FullName `
                -Pattern $Pattern `
                -SimpleMatch `
                -Encoding UTF8 `
                -ErrorAction SilentlyContinue |
                Select-Object -First 12

            foreach ($Match in $Matches) {
                Write-Host (
                    "[" +
                    $Pattern +
                    "] line " +
                    $Match.LineNumber +
                    ": " +
                    $Match.Line.Trim()
                )
            }
        }
        catch {
        }
    }
}

Write-Section "Recent Gemini runner and adapter logs"

$RunStart = (
    Get-Item -LiteralPath $RunDir
).CreationTime.AddMinutes(-10)

$RecentLogs = Get-ChildItem `
    -LiteralPath (Join-Path $GeminiRoot "logs") `
    -Recurse `
    -File `
    -Force `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.LastWriteTime -ge $RunStart -and
        $_.Extension.ToLowerInvariant() -in @(
            ".txt",
            ".log",
            ".jsonl",
            ".ndjson"
        )
    } |
    Sort-Object LastWriteTime

if ($RecentLogs.Count -eq 0) {
    Write-Host "No recent log files were found."
}
else {
    foreach ($Log in $RecentLogs) {
        Write-Host (
            $Log.LastWriteTime.ToString("s") +
            " | " +
            $Log.FullName +
            " | bytes=" +
            $Log.Length
        )
    }

    foreach ($Log in $RecentLogs) {
        if (
            $Log.Name -match "adapter|smoke|runner|stderr|stdout"
        ) {
            Show-TextTail `
                -Path $Log.FullName `
                -Tail 160
        }
    }
}

Write-Section "Workspace deliverable check"

$StockReports = Get-ChildItem `
    -LiteralPath $RunDir `
    -Recurse `
    -File `
    -Filter "stock_report.txt" `
    -Force `
    -ErrorAction SilentlyContinue

if ($StockReports.Count -eq 0) {
    Write-Host "stock_report.txt: MISSING" -ForegroundColor Red
}
else {
    foreach ($Report in $StockReports) {
        Write-Host (
            "stock_report.txt: PRESENT | " +
            $Report.FullName +
            " | bytes=" +
            $Report.Length
        ) -ForegroundColor Green

        Show-TextTail `
            -Path $Report.FullName `
            -Tail 80
    }
}

Write-Section "Interpretation guide"

Write-Host "A. No transcript/event file, no TTFT, no Usage:"
Write-Host "   The request stalled before the runner observed a model event."
Write-Host "   Inspect Window A adapter output and upstream request lifecycle."
Write-Host ""
Write-Host "B. A tool_call exists but no matching tool_result:"
Write-Host "   The Gemini built-in network tool path stalled or is unsupported."
Write-Host ""
Write-Host "C. Repeated web/search calls exist until 300s:"
Write-Host "   The Agent entered an inefficient research loop; add a network-tool"
Write-Host "   canary and a strict search/write time budget before the full run."
Write-Host ""
Write-Host "D. response.completed or a final result exists but runner says timeout:"
Write-Host "   The stream-json parser or completion-state adapter needs fixing."
Write-Host ""
Write-Host "E. stock_report.txt exists despite timeout:"
Write-Host "   Separate content completion from execution termination; do not"
Write-Host "   discard the artifact, but fix termination classification."

Write-Host ""
Write-Host "PASS: diagnostic collection completed; no API request was made." `
    -ForegroundColor Green
