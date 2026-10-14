<#
.SYNOPSIS
  Samples who connects to PactPro_db (read-only), to find writers other than AMS.

.DESCRIPTION
  Every -IntervalSeconds it reads pg_stat_activity for the database plus the
  insert/update/delete counters of its busiest tables, and appends them to CSV
  files. It runs for -DurationHours (default 7 days) and then stops. Its own
  connection is tagged application_name=ams_activity_sampler and excluded.
  No query text is recorded (it can contain client data); only who, from where,
  when and in which state.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File db_activity_sampler.ps1 -OutDir C:\AMS_Baseline\activity
#>
param(
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$Database = 'PactPro_db',
    [string]$DbHost = 'localhost',
    [int]$DbPort = 5432,
    [string]$DbUser = 'postgres',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [int]$IntervalSeconds = 300,
    [double]$DurationHours = 168,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$env:PGAPPNAME = 'ams_activity_sampler'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$psql = Join-Path $PgBin 'psql.exe'
$args0 = @('-h', $DbHost, '-p', $DbPort, '-U', $DbUser, '-d', $Database, '-X', '-w', '-A', '-F', ',', '-t')
$connFile = Join-Path $OutDir 'connections.csv'
$tablesFile = Join-Path $OutDir 'table_activity.csv'
if (-not (Test-Path $connFile)) {
    'sampled_at,usename,application_name,client_addr,client_hostname,backend_start,state,backend_type' | Set-Content $connFile -Encoding UTF8
}
if (-not (Test-Path $tablesFile)) {
    'sampled_at,table,n_tup_ins,n_tup_upd,n_tup_del' | Set-Content $tablesFile -Encoding UTF8
}

$connSql = "SELECT now(), usename, application_name, client_addr, client_hostname, backend_start, state, backend_type " +
           "FROM pg_stat_activity WHERE datname = current_database() AND application_name <> 'ams_activity_sampler'"
$tableSql = "SELECT now(), schemaname || '.' || relname, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables " +
            "WHERE n_tup_ins + n_tup_upd + n_tup_del > 0"

$until = (Get-Date).AddHours($DurationHours)
do {
    try {
        & $psql @args0 -c 'SET default_transaction_read_only = on' -c $connSql | Add-Content $connFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { throw "psql exit $LASTEXITCODE reading pg_stat_activity (check pgpass.conf)" }
        & $psql @args0 -c 'SET default_transaction_read_only = on' -c $tableSql | Add-Content $tablesFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { throw "psql exit $LASTEXITCODE reading pg_stat_user_tables" }
    } catch {
        Add-Content (Join-Path $OutDir 'sampler_errors.log') ("{0}  {1}" -f (Get-Date -Format 's'), $_.Exception.Message)
        if ($Once) { exit 1 }
    }
    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
} while ((Get-Date) -lt $until)
