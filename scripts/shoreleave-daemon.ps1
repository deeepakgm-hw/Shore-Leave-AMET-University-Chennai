# Shore Leave 24/7 Background Service Daemon
$ErrorActionPreference = "Continue"

$root = "c:\Users\deepu\Downloads\update shore leave"
$backend = Join-Path $root "backend"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$cloudflaredExe = "C:\Users\deepu\cloudflared.exe"
$cloudflaredConfig = "C:\Users\deepu\.cloudflared\config.yml"
$logDir = Join-Path $root "runtime-logs"
$daemonLog = Join-Path $logDir "daemon.log"
$pidFile = Join-Path $logDir "shoreleave-daemon.pid"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

function Write-DaemonLog($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $daemonLog -Value "[$timestamp] $msg" -Encoding UTF8 -ErrorAction SilentlyContinue

    # Rotate log if larger than 2MB
    try {
        if ((Test-Path $daemonLog) -and (Get-Item $daemonLog).Length -gt 2MB) {
            $tail = Get-Content -Path $daemonLog -Tail 500
            Set-Content -Path $daemonLog -Value $tail -Encoding UTF8 -ErrorAction SilentlyContinue
        }
    } catch {}
}

# Single daemon instance check via PID file
if (Test-Path $pidFile) {
    $oldPidStr = (Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPidStr -and ($oldPidStr.Trim() -match '^\d+$')) {
        $oldPid = [int]($oldPidStr.Trim())
        if ($oldPid -ne $PID) {
            $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
            if ($oldProc) {
                $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction SilentlyContinue).CommandLine
                if ($cmd -like "*shoreleave-daemon.ps1*") {
                    Write-DaemonLog "Daemon already active (PID: $oldPid). Exiting duplicate launcher."
                    exit 0
                }
            }
        }
    }
}

$PID | Set-Content -Path $pidFile -Encoding ASCII -Force
Write-DaemonLog "Shore Leave daemon started (PID: $PID)"

function Test-BackendHealth {
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -Method Get -TimeoutSec 4 -ErrorAction Stop
        if ($res.ok -eq $true -and $res.service -eq "shore-leave-backend") {
            return $true
        }
    } catch {}
    return $false
}

function Get-BackendProcesses {
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq "node.exe" -and
        $_.CommandLine -like "*server.js*"
    })
}

while ($true) {
    # 1. Backend Service Check
    try {
        $isHealthy = Test-BackendHealth
        if (-not $isHealthy) {
            $backendProcs = Get-BackendProcesses
            if ($backendProcs -and $backendProcs.Count -gt 0) {
                # If multiple backend processes exist, terminate duplicates
                if ($backendProcs.Count -gt 1) {
                    Write-DaemonLog "Detected $($backendProcs.Count) duplicate server.js processes. Cleaning up..."
                    foreach ($bp in $backendProcs) {
                        Stop-Process -Id $bp.ProcessId -Force -ErrorAction SilentlyContinue
                    }
                    Start-Sleep -Seconds 2
                    $backendProcs = @()
                } else {
                    $primary = $backendProcs[0]
                    $uptimeSec = 999
                    try {
                        if ($primary.CreationDate) {
                            $uptimeSec = ((Get-Date) - $primary.CreationDate).TotalSeconds
                        }
                    } catch {}

                    if ($uptimeSec -lt 45 -and $uptimeSec -ge 0) {
                        Write-DaemonLog "Backend PID $($primary.ProcessId) is initializing (uptime: $([int]$uptimeSec)s). Waiting..."
                    } else {
                        Write-DaemonLog "Backend PID $($primary.ProcessId) is unresponsive after $([int]$uptimeSec)s. Restarting..."
                        Stop-Process -Id $primary.ProcessId -Force -ErrorAction SilentlyContinue
                        Start-Sleep -Seconds 2
                        $backendProcs = @()
                    }
                }
            }

            # If no running backend process after cleanup, start it
            if (-not $backendProcs -or $backendProcs.Count -eq 0) {
                $portOwner = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
                if ($portOwner) {
                    Write-DaemonLog "Terminating conflicting process on port 3000 (PID: $portOwner)..."
                    Stop-Process -Id $portOwner -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 2
                }

                Write-DaemonLog "Starting Shore Leave backend (node server.js)..."
                Start-Process -FilePath $nodeExe `
                    -ArgumentList "server.js" `
                    -WorkingDirectory $backend `
                    -WindowStyle Hidden `
                    -ErrorAction SilentlyContinue

                Write-DaemonLog "Backend process spawned. Waiting 25s for database connection..."
                Start-Sleep -Seconds 25
            }
        }
    } catch {
        Write-DaemonLog "Error checking/recovering backend: $_"
    }

    # 2. Cloudflare Tunnel Check
    try {
        $cf = Get-Process cloudflared -ErrorAction SilentlyContinue
        if (-not $cf) {
            Write-DaemonLog "Cloudflared not running. Starting tunnel..."
            Start-Process -FilePath $cloudflaredExe `
                -ArgumentList "tunnel --config `"$cloudflaredConfig`" run" `
                -WorkingDirectory $root `
                -WindowStyle Hidden `
                -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 5
        }
    } catch {
        Write-DaemonLog "Error checking/starting cloudflared: $_"
    }

    Start-Sleep -Seconds 15
}
