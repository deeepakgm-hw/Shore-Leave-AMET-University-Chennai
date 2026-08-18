param(
  [string]$TaskName = "ShoreLeaveBackendWatchdog"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$watchdog = Join-Path $PSScriptRoot "keep-backend-up.ps1"
$logDir = Join-Path $root "runtime-logs"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

try {
  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdog`" -Minutes 0 -Force"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Keeps the Shore Leave backend available at http://localhost:3000" `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Installed and started scheduled task $TaskName."
} catch {
  $startup = [Environment]::GetFolderPath("Startup")
  $launcher = Join-Path $startup "Start Shore Leave Backend.cmd"
  $command = "@echo off`r`nstart `"`" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$watchdog`" -Minutes 0 -Force`r`n"
  Set-Content -Path $launcher -Value $command -Encoding ASCII

  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$watchdog`" -Minutes 0 -Force" `
    -WindowStyle Hidden

  Write-Host "Scheduled Task was unavailable, so installed Startup launcher:"
  Write-Host $launcher
}

Write-Host "Shore Leave will auto-start at login and stay available at http://localhost:3000."
