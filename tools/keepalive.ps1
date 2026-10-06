<#
Keep one background process running: start it, and when it stops for any
reason, log why and start it again.

Used for the processes nothing else watches: the court scraper (port 8000) and
the notifications scheduler. The scraper once died unnoticed and every court
feature quietly returned 503 for a day (NEXT_STEPS 5.2); the scheduler simply
was never started, so no hearing reminders went out.

Everything is logged to <repo>\logs\<Name>.log: the process's own output, plus a
line for each start and stop with its exit code. A process that keeps failing
straight after start is retried with a growing pause (5s up to 5 min) instead of
spinning.

Normally started by the scheduled tasks from tools\install-services.ps1; it can
also be run by hand:

    powershell -ExecutionPolicy Bypass -File tools\keepalive.ps1 -Name Scraper `
        -WorkDir C:\Users\Sybrant\scrap -Exe venv\Scripts\python.exe `
        -Arguments "-m uvicorn api.main:app --host 127.0.0.1 --port 8000"
#>
param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string] $WorkDir,
    [Parameter(Mandatory)] [string] $Exe,
    [string] $Arguments = ''
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$Name.log"

function Write-Log([string] $msg) {
    Add-Content -Path $log -Value ("{0}  [keepalive] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding utf8
}

# Keep the log from growing without limit: roll it over at 10 MB.
function Roll-Log {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) {
        Move-Item -Force $log "$log.1"
    }
}

# Append the lines of $file past the first $seen to the log; return the new count.
function Copy-NewLines([string] $file, [int] $seen) {
    if (-not (Test-Path $file)) { return $seen }
    $lines = @(Get-Content $file -ErrorAction SilentlyContinue)
    if ($lines.Count -gt $seen) {
        Add-Content -Path $log -Value $lines[$seen..($lines.Count - 1)] -Encoding utf8
    }
    return $lines.Count
}

$exePath = if ([IO.Path]::IsPathRooted($Exe)) { $Exe } else { Join-Path $WorkDir $Exe }
$pause = 5
while ($true) {
    Roll-Log
    if (-not (Test-Path $exePath)) {
        Write-Log "cannot start: $exePath not found; retrying in 5 min"
        Start-Sleep -Seconds 300
        continue
    }
    Write-Log "starting: $exePath $Arguments (in $WorkDir)"
    $started = Get-Date
    $out = Join-Path $logDir "$Name.out.tmp"
    $err = Join-Path $logDir "$Name.err.tmp"
    $p = Start-Process -FilePath $exePath -ArgumentList $Arguments -WorkingDirectory $WorkDir `
        -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    # Touch the handle now; without it .NET can't report ExitCode afterwards.
    $null = $p.Handle
    # Copy the child's output into the log as it runs, so a hang is visible too.
    $seenOut = 0; $seenErr = 0
    while (-not $p.HasExited) {
        Start-Sleep -Seconds 5
        $seenOut = Copy-NewLines $out $seenOut
        $seenErr = Copy-NewLines $err $seenErr
        Roll-Log
    }
    $null = Copy-NewLines $out $seenOut
    $null = Copy-NewLines $err $seenErr
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    $ran = (Get-Date) - $started
    Write-Log ("stopped with exit code {0} after {1:N0}s; restarting in {2}s" -f $p.ExitCode, $ran.TotalSeconds, $pause)
    Start-Sleep -Seconds $pause
    # Ran a while: it was a one-off stop, start again quickly next time.
    # Died straight away: back off, up to 5 minutes.
    $pause = if ($ran.TotalSeconds -gt 120) { 5 } else { [Math]::Min($pause * 2, 300) }
}
