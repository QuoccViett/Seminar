-- Chạy bằng psql trên DB kiểm tải trong lúc k6 hoạt động.
SELECT pid, wait_event_type, wait_event, state, clock_timestamp() - xact_start AS transaction_age,
       pg_blocking_pids(pid) AS blocked_by
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY xact_start NULLS LAST;

SELECT relation::regclass AS relation, mode, granted, count(*)
FROM pg_locks
WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
GROUP BY relation, mode, granted ORDER BY granted, relation, mode;

-- Cần bật pg_stat_statements trên DB staging trước khi dùng truy vấn cuối.
SELECT queryid, calls, mean_exec_time, total_exec_time, rows
FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC LIMIT 20;
