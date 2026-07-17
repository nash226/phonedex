param(
  [ValidateSet("install", "start", "stop", "status", "uninstall", "run-service")]
  [string] $Action = "install"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "PhoneDex"
$TaskPath = "\PhoneDex\"
$ScriptPath = Join-Path $Root "scripts\install-windows-task.ps1"
$BridgePath = Join-Path $Root "bin\codex-watch.js"
$LocalDir = Join-Path $Root ".local"
$LogPath = Join-Path $LocalDir "windows-service.log"
$RestartCount = 5
$RestartInterval = New-TimeSpan -Minutes 1

if ($env:USERDOMAIN) {
  $TaskUser = "$env:USERDOMAIN\$env:USERNAME"
} else {
  $TaskUser = $env:USERNAME
}

function Ensure-LocalDir {
  if (-not (Test-Path $LocalDir)) {
    New-Item -ItemType Directory -Path $LocalDir | Out-Null
  }
}

function Find-PowerShell {
  $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  $powershell = Get-Command powershell.exe -ErrorAction Stop
  return $powershell.Source
}

function Find-Node {
  $node = Get-Command node.exe -ErrorAction Stop
  return $node.Source
}

function Invoke-RunService {
  Ensure-LocalDir
  $node = Find-Node
  Set-Location $Root
  Add-Content -Path $LogPath -Value "[$(Get-Date -Format o)] starting PhoneDex service from $Root"
  & $node $BridgePath service *>> $LogPath
}

function Install-Task {
  Ensure-LocalDir
  $powerShell = Find-PowerShell
  $quotedScript = '"' + $ScriptPath + '"'
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File $quotedScript run-service"
  $action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $TaskUser
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
    -MultipleInstances IgnoreNew `
    -RestartCount $RestartCount `
    -RestartInterval $RestartInterval

  Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath $TaskPath `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Run the PhoneDex Codex completion bridge and session watcher at user logon." `
    -Force | Out-Null

  Write-Host "Installed scheduled task $TaskPath$TaskName"
  Start-Task
}

function Start-Task {
  Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
  Write-Host "Started scheduled task $TaskPath$TaskName"
}

function Stop-Task {
  Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
  Write-Host "Stopped scheduled task $TaskPath$TaskName"
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Host "PhoneDex scheduled task is not installed."
    return
  }

  $info = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $TaskPath
  [pscustomobject]@{
    TaskName = "$TaskPath$TaskName"
    State = $task.State
    LastRunTime = $info.LastRunTime
    LastTaskResult = $info.LastTaskResult
    NextRunTime = $info.NextRunTime
    RestartPolicy = "up to $RestartCount attempts at $($RestartInterval.TotalMinutes)-minute intervals; starts when available"
    LogPath = $LogPath
  } | Format-List
}

function Uninstall-Task {
  Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task $TaskPath$TaskName"
}

switch ($Action) {
  "install" { Install-Task }
  "start" { Start-Task }
  "stop" { Stop-Task }
  "status" { Show-Status }
  "uninstall" { Uninstall-Task }
  "run-service" { Invoke-RunService }
}
