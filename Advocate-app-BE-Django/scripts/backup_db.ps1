<#
.SYNOPSIS
  Backs up the AMS database and uploaded files (Phase 0 safety baseline).

.DESCRIPTION
  Read-only towards the database: it runs pg_dump of PactPro_db and never restores,
  drops or writes to any database. Each run:

    1. works in <BackupDir>\inprogress\<stamp> so a half-written backup is never
       mistaken for a good one;
    2. pg_dump -Fc (custom format) + a schema-only SQL file;
    3. checks the dump is readable (pg_restore --list);
    4. records exact row counts and constraint/index counts (the restore check
       compares against these);
    5. copies the upload folders (documents, branding, drafting media);
    6. writes a SHA-256 manifest of every file and a COMPLETE marker;
    7. moves the folder to <BackupDir>\daily\<stamp>. A failed run is moved to
       <BackupDir>\failed\<stamp> with its log and the script exits 1.

  Retention (30 daily, 8 weekly, 12 monthly by default) is only REPORTED unless
  -ApplyRetention is given, and the newest complete backup is never deleted.

  Credentials: none in this script. pg_dump reads the password from the
  PostgreSQL password file (%APPDATA%\postgresql\pgpass.conf) or PGPASSFILE.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backup_db.ps1 -BackupDir E:\AMS_Backups -DryRun
#>
param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [string]$Database = 'PactPro_db',
    [string]$DbHost = 'localhost',
    [int]$DbPort = 5432,
    [string]$DbUser = 'postgres',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [string[]]$UploadDirs = @(),
    [int]$DailyKeepDays = 30,
    [int]$WeeklyKeep = 8,
    [int]$MonthlyKeep = 12,
    [switch]$ApplyRetention,
    [switch]$AllowSystemDrive,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$env:PGAPPNAME = 'ams_backup'
# Drafting media (settings.MEDIA_ROOT) lives outside the repo; include it when set.
if ($env:AMS_MEDIA_DIR -and ($UploadDirs -notcontains $env:AMS_MEDIA_DIR)) { $UploadDirs += $env:AMS_MEDIA_DIR }

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 's'), $msg
    Write-Host $line
    if ($script:logFile) { Add-Content -Path $script:logFile -Value $line -Encoding UTF8 }
}

# ---- guard rails -----------------------------------------------------------
$BackupDir = [IO.Path]::GetFullPath($BackupDir)
if (-not (Test-Path ([IO.Path]::GetPathRoot($BackupDir)))) {
    throw "The drive or share for $BackupDir is not available (disk not connected / share not reachable)."
}
$systemDrive = [IO.Path]::GetPathRoot($env:SystemRoot)
if ([IO.Path]::GetPathRoot($BackupDir) -ieq $systemDrive -and -not $AllowSystemDrive) {
    throw "BackupDir $BackupDir is on the system drive ($systemDrive). Use another disk or a network share (or -AllowSystemDrive for a test run)."
}
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
if ($BackupDir.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "BackupDir must be outside the repository ($repoRoot): backups hold every client's data."
}
foreach ($tool in 'pg_dump.exe', 'pg_restore.exe', 'psql.exe') {
    if (-not (Test-Path (Join-Path $PgBin $tool))) { throw "$tool not found in $PgBin" }
}
if ($env:PGPASSWORD) {
    Log 'NOTE: PGPASSWORD is set in the environment; prefer pgpass.conf so the password is not visible to other processes.'
}

$inprogress = Join-Path $BackupDir "inprogress\$stamp"
$final = Join-Path $BackupDir "daily\$stamp"

if ($DryRun) {
    Write-Host "DRY RUN - nothing will be written."
    Write-Host "  database      : $Database on ${DbHost}:$DbPort as $DbUser (pg_dump, read-only)"
    Write-Host "  working folder: $inprogress"
    Write-Host "  final folder  : $final"
    foreach ($d in $UploadDirs) { Write-Host ("  upload copy   : {0} (exists: {1})" -f $d, (Test-Path $d)) }
    Write-Host "  retention     : $DailyKeepDays days daily, $WeeklyKeep weekly, $MonthlyKeep monthly; apply = $ApplyRetention"
    exit 0
}

New-Item -ItemType Directory -Force -Path $inprogress | Out-Null
$script:logFile = Join-Path $inprogress 'backup.log'
$psqlArgs = @('-h', $DbHost, '-p', $DbPort, '-U', $DbUser, '-d', $Database, '-X', '-w', '-A', '-F', ',', '-t', '-v', 'ON_ERROR_STOP=1')

try {
    Log "Backup of $Database started -> $inprogress"
    $dump = Join-Path $inprogress "$Database.dump"
    & (Join-Path $PgBin 'pg_dump.exe') -h $DbHost -p $DbPort -U $DbUser -w -Fc -Z 6 -f $dump $Database
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }
    & (Join-Path $PgBin 'pg_dump.exe') -h $DbHost -p $DbPort -U $DbUser -w --schema-only -f (Join-Path $inprogress "$Database.schema.sql") $Database
    if ($LASTEXITCODE -ne 0) { throw "pg_dump --schema-only failed (exit $LASTEXITCODE)" }

    # The dump must be readable as a whole archive.
    $toc = & (Join-Path $PgBin 'pg_restore.exe') --list $dump
    if ($LASTEXITCODE -ne 0 -or -not $toc) { throw 'pg_restore --list could not read the dump' }
    $toc | Set-Content -Path (Join-Path $inprogress 'dump_toc.txt') -Encoding UTF8
    Log ("Dump OK: {0:N1} MB, {1} archive entries" -f ((Get-Item $dump).Length / 1MB), $toc.Count)

    # Snapshots the restore check compares against. The dump is taken first, so
    # counts may differ by rows written in between; restore_verify reports that.
    & (Join-Path $PgBin 'psql.exe') @psqlArgs -f (Join-Path $scriptDir 'table_counts.sql') -o (Join-Path $inprogress 'table_counts.csv')
    if ($LASTEXITCODE -ne 0) { throw 'row count snapshot failed' }
    & (Join-Path $PgBin 'psql.exe') @psqlArgs -f (Join-Path $scriptDir 'schema_summary.sql') -o (Join-Path $inprogress 'schema_summary.csv')
    if ($LASTEXITCODE -ne 0) { throw 'schema summary snapshot failed' }

    # Uploaded files: documents, branding, drafting media.
    $i = 0
    foreach ($dir in $UploadDirs) {
        $i++
        if (-not (Test-Path $dir)) { Log "WARNING: upload folder not found, skipped: $dir"; continue }
        $target = Join-Path $inprogress ("files\{0}_{1}" -f $i, (Split-Path $dir -Leaf))
        robocopy $dir $target /E /R:2 /W:5 /NP /NFL /NDL /LOG+:"$script:logFile" | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $dir (exit $LASTEXITCODE)" }
        Add-Content -Path (Join-Path $inprogress 'file_sources.txt') -Value ("{0}`t{1}" -f $target, $dir) -Encoding UTF8
        Log "Copied $dir"
    }

    # SHA-256 manifest of everything in the backup.
    $manifest = Join-Path $inprogress 'manifest.sha256'
    Get-ChildItem -Path $inprogress -Recurse -File |
        Where-Object { $_.Name -notin 'manifest.sha256', 'backup.log', 'COMPLETE' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($inprogress.Length + 1)
            "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash, $rel
        } | Set-Content -Path $manifest -Encoding UTF8
    Log ("Manifest: {0} files" -f (Get-Content $manifest).Count)

    @{ database = $Database; stamp = $stamp; host = $env:COMPUTERNAME
       dump_bytes = (Get-Item $dump).Length; completed = (Get-Date -Format 's') } |
        ConvertTo-Json | Set-Content -Path (Join-Path $inprogress 'COMPLETE') -Encoding UTF8

    New-Item -ItemType Directory -Force -Path (Split-Path $final) | Out-Null
    Move-Item -Path $inprogress -Destination $final
    $script:logFile = Join-Path $final 'backup.log'
    Log "Backup complete: $final"
}
catch {
    Log "BACKUP FAILED: $($_.Exception.Message)"
    $failed = Join-Path $BackupDir "failed\$stamp"
    New-Item -ItemType Directory -Force -Path (Split-Path $failed) | Out-Null
    if (Test-Path $inprogress) { Move-Item -Path $inprogress -Destination $failed }
    exit 1
}

# ---- retention ----------------------------------------------------------------
$complete = Get-ChildItem -Path (Join-Path $BackupDir 'daily') -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'COMPLETE') } |
    Sort-Object Name -Descending
$keep = @{}
if ($complete) { $keep[$complete[0].FullName] = 'newest known-good' }
$now = Get-Date
$weeks = @{}; $months = @{}
foreach ($b in $complete) {
    $when = [datetime]::ParseExact($b.Name, 'yyyyMMdd_HHmmss', $null)
    if (($now - $when).TotalDays -le $DailyKeepDays) { $keep[$b.FullName] = 'daily' }
    $wk = '{0}-W{1}' -f $when.Year, [Globalization.CultureInfo]::InvariantCulture.Calendar.GetWeekOfYear($when, 'FirstFourDayWeek', 'Monday')
    if (-not $weeks.ContainsKey($wk) -and $weeks.Count -lt $WeeklyKeep) { $weeks[$wk] = $b.FullName; $keep[$b.FullName] = 'weekly' }
    $mo = $when.ToString('yyyy-MM')
    if (-not $months.ContainsKey($mo) -and $months.Count -lt $MonthlyKeep) { $months[$mo] = $b.FullName; $keep[$b.FullName] = 'monthly' }
}
$expired = $complete | Where-Object { -not $keep.ContainsKey($_.FullName) }
foreach ($e in $expired) {
    if ($ApplyRetention) {
        Remove-Item -Recurse -Force -Path $e.FullName
        Log "Retention: deleted $($e.Name)"
    } else {
        Log "Retention: $($e.Name) is past retention (not deleted; run with -ApplyRetention to delete)"
    }
}
exit 0
