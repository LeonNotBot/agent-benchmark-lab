param(
  [string]$ResultsRoot = "C:\pbv5d",
  [int]$RefreshSeconds = 2
)
$ErrorActionPreference="SilentlyContinue"
$ManifestPath=Join-Path $ResultsRoot "replacement_manifest.json"
$ProgressPath=Join-Path $ResultsRoot "replacement_progress.jsonl"
$StatePath=Join-Path $ResultsRoot "current_attempt.json"

while($true){
  Clear-Host
  $M=@()
  if(Test-Path $ManifestPath){
    try{$M=@(Get-Content $ManifestPath -Raw -Encoding UTF8|ConvertFrom-Json)}catch{}
  }
  $Accepted=@($M|Where-Object{$_.accepted -eq $true -and $null-ne$_.score})
  $Mean=if($Accepted.Count){($Accepted|Measure-Object score -Average).Average}else{0}

  $State=$null
  if(Test-Path $StatePath){
    try{$State=Get-Content $StatePath -Raw -Encoding UTF8|ConvertFrom-Json}catch{}
  }

  Write-Host "===================================================================================================="
  Write-Host ("V5d replacement   accepted: {0}/10   accepted mean: {1:N4}" -f $Accepted.Count,$Mean)
  if($State){
    if($State.status -eq "running"){
      try{
        $Start=[datetimeoffset]::Parse([string]$State.started_at)
        $AttemptElapsed=[math]::Max(0,[math]::Round(([datetimeoffset]::Now-$Start).TotalSeconds))
      }catch{$AttemptElapsed=0}
      $DoneElapsed=0.0
      if(Test-Path $ProgressPath){
        foreach($Line in Get-Content $ProgressPath -Encoding UTF8){
          try{$P=$Line|ConvertFrom-Json}catch{continue}
          if($P.task_id -eq $State.task_id -and [int]$P.attempt -lt [int]$State.attempt){
            if($null-ne$P.elapsed_seconds){$DoneElapsed += [double]$P.elapsed_seconds}
          }
        }
      }
      $TaskTotal=[math]::Round($DoneElapsed+$AttemptElapsed)
      Write-Host ("current task      : {0}" -f $State.task_id)
      Write-Host ("current attempt   : {0}/{1}" -f $State.attempt,$State.max_attempts)
      Write-Host ("attempt elapsed   : {0}s" -f $AttemptElapsed)
      Write-Host ("task cumulative   : {0}s" -f $TaskTotal)
      Write-Host ("runner PID        : {0}" -f $State.pid)
    }else{
      Write-Host ("state             : {0}" -f $State.status)
      if($State.task_id){Write-Host ("last task         : {0} attempt {1}/{2}" -f $State.task_id,$State.attempt,$State.max_attempts)}
      if($null-ne$State.elapsed_seconds){Write-Host ("last attempt time : {0}s" -f $State.elapsed_seconds)}
      if($State.reason){Write-Host ("reason            : {0}" -f $State.reason)}
    }
  }else{
    Write-Host "No current_attempt.json yet."
  }
  Write-Host "===================================================================================================="

  if($M.Count){
    $M|Select-Object task_id,status,@{N="score";E={if($null-ne$_.score){"{0:N4}"-f[double]$_.score}else{"-"}}},external_attempt,classification_reason|Format-Table -AutoSize
  }else{
    Write-Host "No accepted/reviewed task yet."
  }
  Start-Sleep -Seconds $RefreshSeconds
}
