<#
.SYNOPSIS
  Proves a backup can be restored, into the isolated database pactpro_restore_check.

.DESCRIPTION
  Safety rules (Phase 0):
    - The only allowed target is pactpro_restore_check. PactPro_db and every other
      database on the server are refused.
    - If the target exists it must contain no tables in public/drf; otherwise the
      script stops. It never drops or replaces a database.
    - The target is created only with -CreateDatabase (an approved action).
  Steps: verify the SHA-256 manifest, pg_restore --exit-on-error, compare row
  counts and constraint/index counts with the backup's snapshots, check the copied
  document files referenced by the restored rows, and write restore_report_<stamp>.md
  into the backup folder. Dropping the check database afterwards is a separate,
  approved manual step (the command is printed, not run).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File restore_verify.ps1 -BackupPath E:\AMS_Backups\daily\20261014_013000 -CreateDatabase
#>
param(
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [string]$TargetDb = 'pactpro_restore_check',
    [string]$DbHost = 'localhost',
    [int]$DbPort = 5432,
    [string]$DbUser = 'postgres',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [switch]$CreateDatabase,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$env:PGAPPNAME = 'ams_restore_verify'
$AllowedTarget = 'pactpro_restore_check'

if ($TargetDb -cne $AllowedTarget) {
    throw "Refusing target '$TargetDb'. Restore verification may only use '$AllowedTarget'."
}
$BackupPath = [IO.Path]::GetFullPath($BackupPath)
foreach ($f in 'COMPLETE', 'manifest.sha256', 'table_counts.csv', 'schema_summary.csv') {
    if (-not (Test-Path (Join-Path $BackupPath $f))) { throw "Not a complete backup: $f missing in $BackupPath" }
}
$dump = Get-ChildItem -Path $BackupPath -Filter '*.dump' | Select-Object -First 1
if (-not $dump) { throw "No .dump file in $BackupPath" }

$psql = Join-Path $PgBin 'psql.exe'
$base = @('-h', $DbHost, '-p', $DbPort, '-U', $DbUser, '-X', '-w', '-A', '-t', '-v', 'ON_ERROR_STOP=1')
$report = New-Object System.Collections.Generic.List[string]
$problems = 0
function Note($line) { $script:report.Add($line); Write-Host $line }
function Problem($line) { $script:problems++; Note "PROBLEM: $line" }

$exists = (& $psql @base -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$AllowedTarget'") -eq '1'

if ($DryRun) {
    Write-Host "DRY RUN - nothing will be written."
    Write-Host "  backup : $BackupPath ($($dump.Name))"
    Write-Host "  target : $AllowedTarget (exists: $exists; create allowed: $CreateDatabase)"
    exit 0
}

Note "# Restore verification $stamp"
Note ""
Note "- Backup: $BackupPath"
Note "- Target: $AllowedTarget on ${DbHost}:$DbPort"

# 1. Manifest.
$bad = 0; $checked = 0
foreach ($line in Get-Content (Join-Path $BackupPath 'manifest.sha256')) {
    if (-not $line.Trim()) { continue }
    $hash, $rel = $line -split '  ', 2
    $path = Join-Path $BackupPath $rel
    $checked++
    if (-not (Test-Path $path) -or (Get-FileHash -Algorithm SHA256 -Path $path).Hash -ne $hash) { $bad++ }
}
if ($bad) { Problem "$bad of $checked files fail the SHA-256 manifest" } else { Note "- Manifest: $checked files OK" }

# 2. Target must be absent (and creation approved) or empty.
if ($exists) {
    $tables = & $psql @base -d $AllowedTarget -c "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','drf')"
    if ([int]$tables -gt 0) {
        throw "$AllowedTarget already contains $tables tables. Not touching it; dropping it needs separate approval."
    }
    Note "- Target exists and is empty"
} elseif ($CreateDatabase) {
    & (Join-Path $PgBin 'createdb.exe') -h $DbHost -p $DbPort -U $DbUser -w $AllowedTarget
    if ($LASTEXITCODE -ne 0) { throw "createdb $AllowedTarget failed" }
    Note "- Created empty $AllowedTarget"
} else {
    throw "$AllowedTarget does not exist. Re-run with -CreateDatabase once its creation is approved."
}

# 3. Restore. Uses the operator account by design (an operator restore of a full
#    dump); the application's in-app restore is a separate code path.
$log = Join-Path $BackupPath "restore_$stamp.log"
& (Join-Path $PgBin 'pg_restore.exe') -h $DbHost -p $DbPort -U $DbUser -w --no-owner --exit-on-error -d $AllowedTarget $dump.FullName 2> $log
if ($LASTEXITCODE -ne 0) { Problem "pg_restore failed (see $log)" } else { Note "- pg_restore: OK" }

# 4. Row counts and schema summary must match the snapshots.
function ReadCsv($path) {
    $m = @{}
    foreach ($l in Get-Content $path) { if ($l) { $k, $v = $l -split ',', 2; $m[$k] = $v } }
    return $m
}
$before = ReadCsv (Join-Path $BackupPath 'table_counts.csv')
$afterFile = Join-Path $BackupPath "restored_counts_$stamp.csv"
& $psql @base -d $AllowedTarget -F ',' -f (Join-Path $scriptDir 'table_counts.sql') -o $afterFile
$after = ReadCsv $afterFile
$diff = @($before.Keys + $after.Keys | Sort-Object -Unique | Where-Object { $before[$_] -ne $after[$_] })
if ($diff.Count) {
    Problem ("{0} tables differ from the snapshot (rows written between dump and snapshot can explain small differences):" -f $diff.Count)
    foreach ($t in $diff) { Note ("    {0}: snapshot {1}, restored {2}" -f $t, $before[$t], $after[$t]) }
} else { Note ("- Row counts: all {0} tables match" -f $before.Count) }

$sBefore = ReadCsv (Join-Path $BackupPath 'schema_summary.csv')
$sAfterFile = Join-Path $BackupPath "restored_schema_$stamp.csv"
& $psql @base -d $AllowedTarget -F ',' -f (Join-Path $scriptDir 'schema_summary.sql') -o $sAfterFile
$sAfter = ReadCsv $sAfterFile
foreach ($k in ($sBefore.Keys + $sAfter.Keys | Sort-Object -Unique)) {
    if ($sBefore[$k] -ne $sAfter[$k]) { Problem "${k}: snapshot $($sBefore[$k]), restored $($sAfter[$k])" }
}
if (-not $problems) { Note "- Constraints / indexes / tables: match" }

# 5. Document files referenced by restored rows must be in the file copy.
$names = & $psql @base -d $AllowedTarget -c "SELECT stored_name FROM documents WHERE stored_name IS NOT NULL UNION SELECT stored_name FROM document_version WHERE stored_name IS NOT NULL"
$copied = @{}
$filesRoot = Join-Path $BackupPath 'files'
if (Test-Path $filesRoot) { Get-ChildItem -Path $filesRoot -Recurse -File | ForEach-Object { $copied[$_.Name] = $true } }
$missing = @($names | Where-Object { $_ -and -not $copied.ContainsKey($_) })
Note ("- Document files: {0} referenced, {1} not in the backup copy" -f @($names).Count, $missing.Count)
if ($missing.Count) { Note "    (expected for rows already missing their file on the live server - see baseline anomalies)" }

Note ""
Note ("Result: {0}" -f $(if ($problems) { "$problems problem(s)" } else { 'PASS' }))
Note "To remove the check database later (needs approval): dropdb -h $DbHost -p $DbPort -U $DbUser $AllowedTarget"
$report | Set-Content -Path (Join-Path $BackupPath "restore_report_$stamp.md") -Encoding UTF8
if ($problems) { exit 1 } else { exit 0 }
