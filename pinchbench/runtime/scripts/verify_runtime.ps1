$ErrorActionPreference="Stop"
$Root="C:\pinchbench-runtime"
$Python="$Root\.venv\Scripts\python.exe"
$Skill="$Root\skill"
$Commit="819384ae830492365b8363fc26bc2602e73f216d"
if(-not(Test-Path -LiteralPath $Python)){throw "Missing runtime Python: $Python"}
if(-not(Test-Path -LiteralPath "$Skill\.git")){throw "Missing PinchBench repository: $Skill"}
$Actual=(git -C $Skill rev-parse HEAD).Trim()
if($Actual -ne $Commit){throw "PinchBench commit mismatch: $Actual"}
& $Python --version
& $Python -m pip --version
& $Python -m pip check
& $Python -c "import sys; print(sys.executable)"
Write-Host "PinchBench commit=$Actual"
Write-Host "PASS: PinchBench shared runtime verified."
