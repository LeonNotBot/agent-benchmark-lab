$ErrorActionPreference="Stop"
$Root="C:\pinchbench-runtime"
$Venv="$Root\.venv"
$Skill="$Root\skill"
$Commit="819384ae830492365b8363fc26bc2602e73f216d"
$Requirements=Join-Path $PSScriptRoot "..\requirements-lock.txt"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
if(-not(Test-Path -LiteralPath "$Venv\Scripts\python.exe")){py -3.12 -m venv $Venv}
& "$Venv\Scripts\python.exe" -m pip install --upgrade pip
& "$Venv\Scripts\python.exe" -m pip install -r $Requirements
if(-not(Test-Path -LiteralPath "$Skill\.git")){git clone "https://github.com/pinchbench/skill.git" $Skill}
git -C $Skill fetch --all --tags
git -C $Skill checkout --detach $Commit
$Actual=(git -C $Skill rev-parse HEAD).Trim()
if($Actual -ne $Commit){throw "PinchBench commit mismatch: $Actual"}
& "$Venv\Scripts\python.exe" -m pip check
Write-Host "PASS: PinchBench shared runtime installed."
Write-Host "Python=$Venv\Scripts\python.exe"
Write-Host "Skill=$Skill"
Write-Host "PinchBench=$Actual"
