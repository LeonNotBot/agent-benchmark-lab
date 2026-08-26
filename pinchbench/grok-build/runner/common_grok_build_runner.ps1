function Set-GrokBenchmarkEnvironment {
    param([string]$Root = "C:\pinchbench-grok-build", [string]$ProxyUrl = "http://127.0.0.1:10090")
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $env:PYTHONUTF8 = "1"; $env:PYTHONIOENCODING = "utf-8"; $env:RUST_LOG = "error"
    $env:GROK_HOME = Join-Path $Root "benchmark-home"
    $env:Path = (Join-Path $Root "bin") + ";" + $env:Path
    if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
        $env:HTTP_PROXY=$ProxyUrl; $env:HTTPS_PROXY=$ProxyUrl; $env:ALL_PROXY=$ProxyUrl
    }
    $items=@("localhost","127.0.0.1","::1")
    foreach($existing in @([string]$env:NO_PROXY,[string]$env:no_proxy)) {
        if($existing){$items += ($existing -split "," | ForEach-Object {$_.Trim()} | Where-Object {$_})}
    }
    $value=($items|Select-Object -Unique)-join ","; $env:NO_PROXY=$value; $env:no_proxy=$value
}
function Assert-OpenRouterKey { if([string]::IsNullOrWhiteSpace([string]$env:OPENROUTER_API_KEY)){throw "OPENROUTER_API_KEY is missing in this PowerShell window."} }
function Resolve-GrokRunnerPaths {
    param([string]$Root="C:\pinchbench-grok-build",[string]$Python="",[string]$SkillDir="")
    $py=@($Python,(Join-Path $Root ".venv\Scripts\python.exe"),"C:\pinchbench-opencode\.venv\Scripts\python.exe","C:\pinchbench-codex\.venv\Scripts\python.exe")|Where-Object {$_}
    $PythonPath=$py|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
    if(-not $PythonPath){throw "No supported Python environment found."}
    $skills=@($SkillDir,(Join-Path $Root "skill"),"C:\pinchbench-codex\skill","C:\pinchbench-opencode\skill")|Where-Object {$_}
    $SkillPath=$skills|Where-Object {(Test-Path -LiteralPath (Join-Path $_ "tasks\manifest.yaml")) -and (Test-Path -LiteralPath (Join-Path $_ "scripts\lib_grading.py"))}|Select-Object -First 1
    if(-not $SkillPath){throw "No valid PinchBench skill checkout found."}
    $obj=[pscustomobject]@{Python=(Resolve-Path $PythonPath).Path;Skill=(Resolve-Path $SkillPath).Path;Runner=(Join-Path $Root "runner\run_pinchbench_grok_build_windows.py");Grok=(Join-Path $Root "bin\grok.exe");Home=(Join-Path $Root "benchmark-home");Runs=(Join-Path $Root "runs");Logs=(Join-Path $Root "logs\grok-build-runner")}
    foreach($p in @($obj.Python,$obj.Skill,$obj.Runner,$obj.Grok,$obj.Home)){if(-not(Test-Path -LiteralPath $p)){throw "Required path not found: $p"}}
    New-Item -ItemType Directory -Force -Path $obj.Runs,$obj.Logs|Out-Null; return $obj
}
function Assert-GrokSearchAdapter {
    param([string]$AdapterUrl="http://127.0.0.1:8767")
    $h=Invoke-RestMethod -Uri ($AdapterUrl.TrimEnd("/")+"/healthz") -TimeoutSec 5
    if(-not $h.ok -or [string]$h.version -ne "0.2.0" -or [string]$h.target_model -ne "deepseek/deepseek-v4-pro"){throw "Search adapter health/version/model check failed."}
    return $h
}
function Show-LoggedProcessResult { param($Process,[string]$StdoutPath,[string]$StderrPath,[int]$TailLines=160)
    Write-Host ""; if(Test-Path $StdoutPath){Get-Content -LiteralPath $StdoutPath -Encoding UTF8 -Tail $TailLines}
    if((Test-Path $StderrPath)-and(Get-Item $StderrPath).Length -gt 0){Write-Host "stderr tail:" -ForegroundColor Yellow;Get-Content -LiteralPath $StderrPath -Encoding UTF8 -Tail $TailLines}
    Write-Host "Exit code: $($Process.ExitCode)";Write-Host "stdout: $StdoutPath";Write-Host "stderr: $StderrPath"
}
