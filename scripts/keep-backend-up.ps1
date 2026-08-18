param(
  [int]$Minutes = 0,
  [int]$Port = 3000,
  [string]$NodePath = "",
  [switch]$Force
)

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$logDir = Join-Path $root "runtime-logs"
$pidFile = Join-Path $logDir "shoreleave-watchdog.pid"
$watchdogLog = Join-Path $logDir "shoreleave-watchdog.log"
$serverOut = Join-Path $logDir "shoreleave-server.out.log"
$serverErr = Join-Path $logDir "shoreleave-server.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-WatchdogLog($Message) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $watchdogLog -Value "[$stamp] $Message" -Encoding UTF8
}

function Resolve-NodePath {
  if ($NodePath -and (Test-Path $NodePath)) {
    return (Resolve-Path $NodePath).Path
  }

  $cmd = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    return $cmd.Source
  }

  $candidateRoots = @(
    (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"),
    (Join-Path $env:LOCALAPPDATA "ms-playwright-go"),
    (Join-Path $env:LOCALAPPDATA "Autodesk\webdeploy\production")
  )

  foreach ($candidateRoot in $candidateRoots) {
    if (-not (Test-Path $candidateRoot)) { continue }
    $candidate = Get-ChildItem -Path $candidateRoot -Recurse -Filter "node.exe" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  return "node.exe"
}

$resolvedNode = Resolve-NodePath
Write-WatchdogLog "Using Node runtime: $resolvedNode"

if ((Test-Path $pidFile) -and -not $Force) {
  $oldPid = (Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-WatchdogLog "Watchdog already running as PID $oldPid. Use -Force to replace the pid marker."
    exit 0
  }
}

$PID | Set-Content -Path $pidFile -Encoding ASCII

function Test-PortListening {
  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    return $null -ne $listener
  } catch {
    return $false
  }
}

function Test-BackendHealthy {
  if (-not (Test-PortListening)) {
    return $false
  }

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 8
    return $response.StatusCode -eq 200
  } catch {
    Write-WatchdogLog "Health check failed: $($_.Exception.Message)"
    return $false
  }
}

function Stop-PortOwner {
  try {
    $owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($owner in $owners) {
      if ($owner -and (Get-Process -Id $owner -ErrorAction SilentlyContinue)) {
        Write-WatchdogLog "Stopping unhealthy backend process PID $owner"
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-WatchdogLog "Could not stop backend process: $($_.Exception.Message)"
  }
}

function Start-ShoreLeaveServer {
  Write-WatchdogLog "Starting backend on port $Port"
  Set-Content -Path $serverOut -Value "" -Encoding UTF8
  Set-Content -Path $serverErr -Value "" -Encoding UTF8
  Start-Process `
    -FilePath $resolvedNode `
    -ArgumentList "server.js" `
    -WorkingDirectory $backend `
    -RedirectStandardOutput $serverOut `
    -RedirectStandardError $serverErr `
    -WindowStyle Hidden | Out-Null
}

if ($Minutes -gt 0) {
  Write-WatchdogLog "Watchdog started for $Minutes minute(s). Backend: $backend"
  $endAt = (Get-Date).AddMinutes($Minutes)
} else {
  Write-WatchdogLog "Watchdog started with no time limit. Backend: $backend"
  $endAt = [datetime]::MaxValue
}

while ((Get-Date) -lt $endAt) {
  if (-not (Test-BackendHealthy)) {
    if (Test-PortListening) {
      Stop-PortOwner
      Start-Sleep -Seconds 3
    }

    Start-ShoreLeaveServer
    Start-Sleep -Seconds 12
    if (Test-BackendHealthy) {
      Write-WatchdogLog "Backend is healthy on port $Port"
    } else {
      Write-WatchdogLog "Backend did not become ready yet; will retry"
    }
  }

  Start-Sleep -Seconds 10
}

if ($Minutes -gt 0) {
  Write-WatchdogLog "Watchdog finished after $Minutes minute(s)"
} else {
  Write-WatchdogLog "Watchdog stopped"
}
