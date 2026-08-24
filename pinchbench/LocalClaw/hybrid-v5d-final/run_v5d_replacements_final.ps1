param(
  [string]$Root = "C:\pinchbench-our-framework",
  [string]$ResultsRoot = "C:\pbv5d",
  [int]$MaxInfraRetries = 3,
  [switch]$Fresh
)
$ErrorActionPreference="Stop"
$Utf8NoBom=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$Utf8NoBom
$OutputEncoding=$Utf8NoBom
$env:PYTHONIOENCODING="utf-8"
$env:PYTHONUTF8="1"

$Python=Join-Path $Root ".venv\Scripts\python.exe"
$Runner=Join-Path $Root "runner\03_run_pinchbench_our_framework_windows.py"
$Here=Split-Path -Parent $MyInvocation.MyCommand.Path
$Classifier=Join-Path $Here "classify_replacement_attempt.py"
$TaskFile=Join-Path $Here "replacement_task_ids.txt"
$ManifestPath=Join-Path $ResultsRoot "replacement_manifest.json"
$ProgressPath=Join-Path $ResultsRoot "replacement_progress.jsonl"
$StatePath=Join-Path $ResultsRoot "current_attempt.json"
$WrapperRevision="v5d-final-r9-single-retry-layer"
$MaxAttempts=$MaxInfraRetries+1

foreach($P in @($Python,$Runner,$Classifier,$TaskFile)){
  if(!(Test-Path -LiteralPath $P)){throw "Required file not found: $P"}
}
if($MaxInfraRetries -lt 0){throw "MaxInfraRetries must be >= 0"}

if($Fresh){
  $Live=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{
    $_.CommandLine -and $_.CommandLine -match '03_run_pinchbench_our_framework_windows\.py' -and
    $_.CommandLine -match [regex]::Escape($ResultsRoot)
  })
  if($Live.Count -gt 0){
    throw "Cannot -Fresh while a replacement runner is still using $ResultsRoot. Stop PID(s): $($Live.ProcessId -join ', ')"
  }
  if(Test-Path -LiteralPath $ResultsRoot){
    cmd.exe /d /c "rd /s /q `"\\?\$ResultsRoot`"" | Out-Null
    if(Test-Path -LiteralPath $ResultsRoot){throw "Failed to clear ResultsRoot: $ResultsRoot"}
  }
}
New-Item -ItemType Directory -Force -Path $ResultsRoot|Out-Null

function Load-Manifest {
  if(!(Test-Path -LiteralPath $ManifestPath)){return @()}
  try{return @(Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8|ConvertFrom-Json)}
  catch{throw "Manifest is unreadable: $ManifestPath :: $($_.Exception.Message)"}
}
function Save-Manifest([array]$M){
  $M|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $ManifestPath -Encoding UTF8
}
function Add-Progress($Obj){
  ($Obj|ConvertTo-Json -Compress -Depth 12)|Add-Content -LiteralPath $ProgressPath -Encoding UTF8
}
function Save-State($Obj){
  $Obj|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $StatePath -Encoding UTF8
}

$Manifest=@(Load-Manifest)
$Tasks=@(Get-Content -LiteralPath $TaskFile -Encoding UTF8|ForEach-Object{$_.Trim()}|Where-Object{$_})

foreach($Task in $Tasks){
  $Existing=@($Manifest|Where-Object{$_.task_id -eq $Task}|Select-Object -Last 1)
  if($Existing.Count -and $Existing[0].accepted -eq $true){
    Write-Host "[SKIP accepted] $Task score=$($Existing[0].score) status=$($Existing[0].status)"
    continue
  }
  if($Existing.Count -and $Existing[0].review_required -eq $true){
    Write-Warning "Existing REVIEW REQUIRED entry for $Task. Resolve/clear it before continuing."
    exit 3
  }

  $Accepted=$false
  for($Attempt=1;$Attempt -le $MaxAttempts;$Attempt++){
    $Stamp=Get-Date -Format "MMdd_HHmmss"
    $Nonce=[guid]::NewGuid().ToString("N").Substring(0,4)
    $TaskRoot=Join-Path $ResultsRoot $Task
    $AttemptRoot=Join-Path $TaskRoot ("a{0:D2}_{1}_{2}" -f $Attempt,$Stamp,$Nonce)
    New-Item -ItemType Directory -Force -Path $AttemptRoot|Out-Null

    Write-Host ""
    Write-Host "===================================================================================================="
    Write-Host "[replacement] task=$Task attempt=$Attempt/$MaxAttempts (max infra retries=$MaxInfraRetries)"
    Write-Host "IMPORTANT: original runner internal infra retries are DISABLED for this invocation (--infra-retries 0)."
    Write-Host "One Python process = one benchmark attempt."
    Write-Host "results=$AttemptRoot"
    Write-Host "===================================================================================================="

    $Stdout=Join-Path $AttemptRoot "runner.stdout.log"
    $Stderr=Join-Path $AttemptRoot "runner.stderr.log"
    $Args=@(
      $Runner,
      "--skill-dir",(Join-Path $Root "skill"),
      "--tasks-dir",(Join-Path $Root "skill\tasks"),
      "--mode","hybrid",
      "--suite",$Task,
      "--judge-model","openrouter/anthropic/claude-opus-5",
      "--results-dir",$AttemptRoot,
      "--keep-workspaces",
      "--clear-judge-cache",
      "--timeout-multiplier","6",
      "--network-timeout","600",
      "--infra-retries","0"
    )

    $Started=Get-Date
    $SW=[System.Diagnostics.Stopwatch]::StartNew()
    $Proc=Start-Process -FilePath $Python -ArgumentList $Args -NoNewWindow -PassThru -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
    Save-State ([pscustomobject]@{
      task_id=$Task
      attempt=$Attempt
      max_attempts=$MaxAttempts
      max_infra_retries=$MaxInfraRetries
      pid=$Proc.Id
      status="running"
      started_at=$Started.ToString("o")
      attempt_root=$AttemptRoot
      wrapper_revision=$WrapperRevision
    })
    $Proc.WaitForExit()
    $SW.Stop()
    $ExitCode=$Proc.ExitCode
    $AttemptElapsed=[math]::Round($SW.Elapsed.TotalSeconds,3)

    if(Test-Path $Stdout){Get-Content -LiteralPath $Stdout -Encoding UTF8 -ErrorAction SilentlyContinue}
    if(Test-Path $Stderr){Get-Content -LiteralPath $Stderr -Encoding UTF8 -ErrorAction SilentlyContinue}

    $ResultFile=Get-ChildItem -LiteralPath $AttemptRoot -Recurse -Filter "results.json" -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1
    if(!$ResultFile){
      Save-State ([pscustomobject]@{
        task_id=$Task;attempt=$Attempt;max_attempts=$MaxAttempts;pid=$Proc.Id;status="review";
        started_at=$Started.ToString("o");elapsed_seconds=$AttemptElapsed;attempt_root=$AttemptRoot;
        reason="results_json_missing";wrapper_revision=$WrapperRevision
      })
      Add-Progress ([pscustomobject]@{
        task_id=$Task;attempt=$Attempt;decision="review";reason="results_json_missing";
        exit_code=$ExitCode;elapsed_seconds=$AttemptElapsed;attempt_root=$AttemptRoot;time=(Get-Date).ToString("o")
      })
      Write-Warning "REVIEW REQUIRED: runner ended without results.json. No automatic retry."
      Write-Host "stderr: $Stderr"
      exit 3
    }

    $ClassOut=Join-Path $AttemptRoot "classification.json"
    $ClassErr=Join-Path $AttemptRoot "classification.stderr.log"
    $CArgs=@($Classifier,"--results-json",$ResultFile.FullName,"--task-id",$Task)
    $CP=Start-Process -FilePath $Python -ArgumentList $CArgs -NoNewWindow -Wait -PassThru -RedirectStandardOutput $ClassOut -RedirectStandardError $ClassErr
    if($CP.ExitCode -ne 0 -or !(Test-Path $ClassOut)){
      throw "Classifier failed for $Task. See $ClassErr"
    }
    try{$C=Get-Content -LiteralPath $ClassOut -Raw -Encoding UTF8|ConvertFrom-Json}
    catch{throw "Classifier output invalid for ${Task}: $ClassOut"}

    $Evidence=@($C.infra_evidence)
    Write-Host ("CLASSIFY decision={0} reason={1} status={2} score={3} infra_evidence={4} attempt_elapsed={5}s" -f $C.decision,$C.reason,$C.status,$C.score,$Evidence.Count,$AttemptElapsed)
    foreach($E in $Evidence){Write-Host ("  infra: {0} [{1}] {2}" -f $E.kind,$E.source,$E.detail)}

    Add-Progress ([pscustomobject]@{
      task_id=$Task;attempt=$Attempt;decision=$C.decision;reason=$C.reason;status=$C.status;score=$C.score;
      infra_evidence=$Evidence;results_json=$ResultFile.FullName;exit_code=$ExitCode;
      elapsed_seconds=$AttemptElapsed;attempt_root=$AttemptRoot;time=(Get-Date).ToString("o")
    })

    if($C.decision -eq "retry"){
      Save-State ([pscustomobject]@{
        task_id=$Task;attempt=$Attempt;max_attempts=$MaxAttempts;pid=$Proc.Id;status="infra_retry";
        started_at=$Started.ToString("o");elapsed_seconds=$AttemptElapsed;attempt_root=$AttemptRoot;
        reason=$C.reason;wrapper_revision=$WrapperRevision
      })
      if($Attempt -lt $MaxAttempts){
        Write-Warning "Infrastructure-contaminated attempt rejected. Fresh attempt $($Attempt+1)/$MaxAttempts will start."
        continue
      }
      $Manifest=@($Manifest|Where-Object{$_.task_id -ne $Task})
      $Manifest += [pscustomobject]([ordered]@{
        task_id=$Task;accepted=$false;review_required=$false;status="infra_retries_exhausted";score=$C.score;
        external_attempt=$Attempt;max_infra_retries=$MaxInfraRetries;results_json=$ResultFile.FullName;run_dir=$ResultFile.DirectoryName;
        classification_reason=$C.reason;infra_evidence=$Evidence;wrapper_revision=$WrapperRevision;accepted_at=(Get-Date).ToString("o")
      })
      Save-Manifest $Manifest
      Write-Warning "NO CLEAN REPLACEMENT: $Task exhausted $MaxInfraRetries infra retries ($MaxAttempts total attempts)."
      exit 2
    }

    if($C.decision -eq "review"){
      $Manifest=@($Manifest|Where-Object{$_.task_id -ne $Task})
      $Manifest += [pscustomobject]([ordered]@{
        task_id=$Task;accepted=$false;review_required=$true;status=$C.status;success=$C.success;score=$C.score;
        external_attempt=$Attempt;max_infra_retries=$MaxInfraRetries;results_json=$ResultFile.FullName;run_dir=$ResultFile.DirectoryName;
        classification_reason=$C.reason;infra_evidence=$Evidence;wrapper_revision=$WrapperRevision;accepted_at=(Get-Date).ToString("o")
      })
      Save-Manifest $Manifest
      Save-State ([pscustomobject]@{
        task_id=$Task;attempt=$Attempt;max_attempts=$MaxAttempts;pid=$Proc.Id;status="review";
        started_at=$Started.ToString("o");elapsed_seconds=$AttemptElapsed;attempt_root=$AttemptRoot;
        reason=$C.reason;wrapper_revision=$WrapperRevision
      })
      Write-Warning "REVIEW REQUIRED: $Task status=$($C.status) score=$($C.score). No automatic rerun and no acceptance."
      exit 3
    }

    $Manifest=@($Manifest|Where-Object{$_.task_id -ne $Task})
    $Manifest += [pscustomobject]([ordered]@{
      task_id=$Task;accepted=$true;review_required=$false;status=$C.status;success=$C.success;score=$C.score;
      external_attempt=$Attempt;max_infra_retries=$MaxInfraRetries;results_json=$ResultFile.FullName;run_dir=$ResultFile.DirectoryName;
      classification_reason=$C.reason;infra_evidence=$Evidence;wrapper_revision=$WrapperRevision;accepted_at=(Get-Date).ToString("o")
    })
    Save-Manifest $Manifest
    Save-State ([pscustomobject]@{
      task_id=$Task;attempt=$Attempt;max_attempts=$MaxAttempts;pid=$Proc.Id;status="accepted";
      started_at=$Started.ToString("o");elapsed_seconds=$AttemptElapsed;attempt_root=$AttemptRoot;
      score=$C.score;reason=$C.reason;wrapper_revision=$WrapperRevision
    })
    Write-Host "ACCEPTED: task=$Task status=$($C.status) score=$($C.score) reason=$($C.reason)"
    $Accepted=$true
    break
  }
  if(!$Accepted){exit 2}
}

$Manifest=@(Load-Manifest)
Save-State ([pscustomobject]@{
  status="complete";accepted_count=@($Manifest|Where-Object{$_.accepted}).Count;total_tasks=$Tasks.Count;
  finished_at=(Get-Date).ToString("o");wrapper_revision=$WrapperRevision
})
Write-Host ""
Write-Host "Replacement manifest: $ManifestPath"
$Manifest|Select-Object task_id,accepted,status,score,external_attempt,classification_reason|Format-Table -AutoSize
$Bad=@($Manifest|Where-Object{-not $_.accepted})
if($Bad.Count){Write-Warning "$($Bad.Count) task(s) are not accepted. Do NOT merge.";exit 2}
if($Manifest.Count -ne $Tasks.Count){Write-Warning "Manifest has $($Manifest.Count)/$($Tasks.Count) tasks. Do NOT merge.";exit 2}
Write-Host "ALL_REPLACEMENTS_CLEAN"
