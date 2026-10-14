-- Constraint and index counts per kind for the AMS schemas. Read-only.
-- A restored copy must report the same numbers as the backup snapshot.
SELECT 'constraint_' || c.contype::text AS item, count(*) AS n
  FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
 WHERE ns.nspname IN ('public', 'drf')
 GROUP BY c.contype
UNION ALL
SELECT 'index', count(*) FROM pg_indexes WHERE schemaname IN ('public', 'drf')
UNION ALL
SELECT 'table', count(*) FROM information_schema.tables
 WHERE table_schema IN ('public', 'drf') AND table_type = 'BASE TABLE'
ORDER BY 1;
