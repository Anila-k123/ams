<#
Register (or remove) the background processes as Windows scheduled tasks, so
they start at sign-in and come back if they stop:

    PactPro Scraper     the court scraper on 127.0.0.1:8000 (separate repo)
    PactPro Scheduler   manage.py run_scheduler: sends queued notifications
                        every minute and raises hearing / overdue-invoice /
                        task-deadline reminders every 15 minutes

Each task runs tools\keepalive.ps1, which restarts the process whenever it
stops and logs to <repo>\logs\. Tasks are for the signed-in user, run hidden,
and need no admin rights.

    powershell -ExecutionPolicy Bypass -File tools\install-services.ps1            # install + start
    powershell -ExecutionPolicy Bypass -File tools\install-services.ps1 -Status    # are they running?
    powershell -ExecutionPolicy Bypass -File tools\install-services.ps1 -Uninstall # stop + remove

-ScraperDir defaults to $env:SCRAPER_DIR, else %USERPROFILE%\scrap.
#>
param(
    [string] $ScraperDir = $(if ($env:SCRAPER_DIR) { $env:SCRAPER_DIR } else { Join-Path $env:USERPROFILE 'scrap' }),
    [switch] $Uninstall,
    [switch] $Status
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$be = Join-Path $repo 'Advocate-app-BE-Django'
$keepalive = Join-Path $PSScriptRoot 'keepalive.ps1'

$services = @(
    @{ Task = 'PactPro Scraper'; Name = 'Scraper'; WorkDir = $ScraperDir; Exe = 'venv\Scripts\python.exe'
       Arguments = '-m uvicorn api.main:app --host 127.0.0.1 --port 8000'; Match = 'uvicorn.*api\.main:app' },
    @{ Task = 'PactPro Scheduler'; Name = 'Scheduler'; WorkDir = $be; Exe = 'venv\Scripts\python.exe'
       Arguments = 'manage.py run_scheduler'; Match = 'manage\.py run_scheduler' }
)

# The process a task looks after, and its keepalive wrapper (by command line).
function Get-ServiceProcesses($svc) {
    Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -match $svc.Match -or
        ($_.CommandLine -match 'keepalive\.ps1' -and $_.CommandLine -match "-Name $($svc.Name)\b")
    }
}

function Stop-Service-Processes($svc) {
    # Wrapper first, so it doesn't restart what we stop next.
    $procs = @(Get-ServiceProcesses $svc | Sort-Object { $_.CommandLine -notmatch 'keepalive' })
    $ids = @($procs | ForEach-Object { $_.ProcessId })
    # Children too: uvicorn --reload (and the venv launcher) run the server in a
    # child process that inherits the listening socket. Left behind, it keeps
    # port 8000 and the new scraper can never bind.
    $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -in $ids })
    foreach ($p in $procs + $children) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }
}

if ($Status) {
    foreach ($svc in $services) {
        $t = Get-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
        $running = @(Get-ServiceProcesses $svc | Where-Object { $_.CommandLine -notmatch 'keepalive' }).Count -gt 0
        "{0,-18} task: {1,-12} process running: {2}   log: {3}" -f $svc.Task,
            $(if ($t) { $t.State } else { 'not installed' }), $running, (Join-Path $repo "logs\$($svc.Name).log")
    }
    return
}

foreach ($svc in $services) {
    if (Get-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $svc.Task -Confirm:$false
    }
    Stop-Service-Processes $svc
}
if ($Uninstall) { "Removed both tasks and stopped their processes."; return }

foreach ($svc in $services) {
    if (-not (Test-Path (Join-Path $svc.WorkDir $svc.Exe))) {
        throw "$($svc.Task): $(Join-Path $svc.WorkDir $svc.Exe) not found."
    }
    $arg = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Name {1} -WorkDir "{2}" -Exe "{3}" -Arguments "{4}"' -f `
        $keepalive, $svc.Name, $svc.WorkDir, $svc.Exe, $svc.Arguments
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $svc.WorkDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    # No time limit; if the wrapper itself ever dies, Task Scheduler restarts it.
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew -StartWhenAvailable
    Register-ScheduledTask -TaskName $svc.Task -Action $action -Trigger $trigger -Settings $settings `
        -Description "PactPro: keeps '$($svc.Name)' running (tools\keepalive.ps1). Log: logs\$($svc.Name).log" | Out-Null
    Start-ScheduledTask -TaskName $svc.Task
    "Installed and started: $($svc.Task)"
}
