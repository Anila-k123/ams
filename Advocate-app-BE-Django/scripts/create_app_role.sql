-- Restricted database role for the AMS application (Phase 1, P1-12).
--
-- Today AMS connects as the `postgres` superuser, on a server that also hosts
-- other applications' databases. A superuser connection turns any SQL bug into
-- full control of every database on the server (and of the host through
-- COPY ... PROGRAM). The app needs only to read and write its own tables.
--
-- Run as the database owner/administrator, connected to the AMS database, with
-- psql variables:
--   psql -h <host> -p <port> -U <admin> -d <ams database> ^
--        -v app_role=ams_app -v app_password="'<new password>'" -f create_app_role.sql
-- (or omit app_password and set it afterwards with \password ams_app, so it is
-- never on a command line).
--
-- Then in the app's .env: DB_USER=ams_app and DB_PASSWORD empty (the password
-- comes from pgpass.conf) or the new password. Migrations keep running as the
-- owner role: python manage.py migrate with DB_USER=<owner>.
--
-- Rehearse on the isolated development cluster first; never run this on a
-- database before a verified backup exists (docs/OPERATIONS.md).

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
              :'app_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec

\if :{?app_password}
  SELECT format('ALTER ROLE %I PASSWORD %s', :'app_role', :app_password) \gexec
\endif

SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', current_database(), :'app_role') \gexec

-- Both schemas AMS uses: public (AMS) and drf (drafting).
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', s, :'app_role')
  FROM unnest(ARRAY['public', 'drf']) AS s
 WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) \gexec

SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', s, :'app_role')
  FROM unnest(ARRAY['public', 'drf']) AS s
 WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) \gexec

SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I', s, :'app_role')
  FROM unnest(ARRAY['public', 'drf']) AS s
 WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) \gexec

-- Tables and sequences created later by migrations (run as the owner) get the
-- same rights automatically.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
              current_user, s, :'app_role')
  FROM unnest(ARRAY['public', 'drf']) AS s
 WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) \gexec

SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
              current_user, s, :'app_role')
  FROM unnest(ARRAY['public', 'drf']) AS s
 WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) \gexec

-- Check: the role exists and is not privileged.
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
  FROM pg_roles WHERE rolname = :'app_role';
