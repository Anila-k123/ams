-- Exact row count of every table in the AMS schemas (public, drf). Read-only.
-- Used by backup_db.ps1 (snapshot taken with the dump) and restore_verify.ps1
-- (the restored copy must match it).
SELECT table_schema || '.' || table_name AS tbl,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text::bigint AS row_count
  FROM information_schema.tables
 WHERE table_schema IN ('public', 'drf') AND table_type = 'BASE TABLE'
 ORDER BY 1;
