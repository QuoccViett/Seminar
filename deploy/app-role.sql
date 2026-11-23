\set ON_ERROR_STOP on
\getenv app_password DB_APP_PASSWORD
SELECT format('CREATE ROLE seminar_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'seminar_app') \gexec
SELECT format('ALTER ROLE seminar_app PASSWORD %L', :'app_password') \gexec
GRANT CONNECT ON DATABASE seminar TO seminar_app;
GRANT USAGE ON SCHEMA public TO seminar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO seminar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO seminar_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, status_histories FROM seminar_app;
REVOKE ALL ON _prisma_migrations FROM seminar_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
