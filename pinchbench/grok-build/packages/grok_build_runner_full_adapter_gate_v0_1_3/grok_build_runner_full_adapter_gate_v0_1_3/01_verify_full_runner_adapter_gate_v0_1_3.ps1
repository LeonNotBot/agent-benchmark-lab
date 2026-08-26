param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$AdapterUrl = "http://127.0.0.1:8767",
    [string]$Python = "",
    [string]$SkillDir = ""
)

$ErrorActionPreference = "Stop"
$Common = Join-Path $Root "runner\common_grok_build_runner.ps1"
$Runner = Join-Path $Root "runner\run_pinchbench_grok_build_windows.py"
. $Common
Set-GrokBenchmarkEnvironment -Root $Root
$Health = Assert-GrokSearchAdapter -AdapterUrl $AdapterUrl
$Paths = Resolve-GrokRunnerPaths -Root $Root -Python $Python -SkillDir $SkillDir
$Constants = & $Paths.Python -X utf8 -c "import importlib.util; p=r'$Runner'; s=importlib.util.spec_from_file_location('grok_runner_gate_verify',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.RUNNER_REVISION); print(m.DEFAULT_ADAPTER_VERSION); print(m.DEFAULT_MODEL_ID)"
if ($LASTEXITCODE -ne 0) { throw "Runner import verification failed." }
Write-Host "PASS: both active gates accept Adapter v0.1.3."
$Constants
$Health | ConvertTo-Json -Depth 10
