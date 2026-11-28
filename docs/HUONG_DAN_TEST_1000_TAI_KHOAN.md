# Hướng dẫn kiểm thử và đo tải 1000 tài khoản

Áp dụng cho phiên bản tối ưu ngày 28/11/2026. Mục tiêu là xác định sức tải của **1000 tài khoản UNIT thuộc 1000 đơn vị**, cộng 20 ADMIN trong kịch bản thẩm định. Một nghìn tài khoản đã tạo trong DB không có nghĩa là một nghìn người đang thao tác đồng thời; kết luận phải kèm VU thực tế, request mỗi giây, thời gian giữ tải và tài nguyên máy.

Quy trình gồm chuẩn bị DB riêng, chạy năm kịch bản độc lập, theo dõi API và DB trong lúc tải, rồi kiểm tra dữ liệu. Chạy thử 10 VU trước; bài nghiệm thu 1000 VU nên phát tải từ máy khác với backend và DB.

## Trạng thái sáu nhóm tối ưu

| Nhóm | Phần đã triển khai | Phần cần xác nhận khi đo |
| --- | --- | --- |
| Khóa kỳ | Hồ sơ dùng `FOR SHARE`; mỗi hồ sơ vẫn giữ khóa riêng; cấu hình và chuyển phase dùng khóa độc quyền | Lock wait và p95 ghi ở 1000 UNIT, đặc biệt lúc deadline |
| Scheduler và fanout | Transaction đổi phase ngắn, reconcile theo lô 100, outbox commit cùng nghiệp vụ, fanout theo lô | Thời gian chuyển phase, thời gian xử lý hết outbox, độ trễ delivery |
| Worker và email | Concurrency có giới hạn, ngừng nhận việc khi hết ngân sách, gửi credential ngoài transaction, kiểm version, thêm Resend HTTPS | Tốc độ thực, retry, lease, hạn mức và khả năng giao của provider thật |
| Xác thực | bcrypt native cost 12; cache GET danh tính 3 giây; đường ghi và `auth/me` đọc DB | Tải đăng nhập riêng, CPU, độ trễ event loop và mức cache có thể chấp nhận |
| Polling và dashboard | Dừng polling khi tab ẩn, chống chồng request, backoff; polling hồ sơ 30 giây; dashboard cache 5 giây | Số request thực từ trình duyệt, dữ liệu cập nhật và trải nghiệm khi tải |
| Frontend và vận hành | Lazy route và thư viện nặng, cấu hình cache assets, pool DB, cấu hình Compose và PM2 | Header thật sau deploy, LCP và INP, CPU/RAM và giới hạn DB |

**Sáu nhóm đã có thay đổi trong code; chưa có kết luận nghiệm thu sức tải 1000 VU.** Build và kiểm thử chức năng không thay thế kết quả chạy tải. Thư viện Excel vẫn tạo chunk lớn nhưng chỉ được tải khi cần. Email và Push đã được provider chấp nhận có thể đến sau thời điểm reset mật khẩu; mật khẩu cũ bị vô hiệu theo version.

Cache danh tính có thể làm GET nghiệp vụ thông thường thấy quyền cũ tối đa 3 giây trên replica khác. Các API báo cáo và cấp URL minh chứng được đánh dấu `RequireFreshUser`, luôn đọc quyền/trạng thái mới từ DB. Nếu yêu cầu thu hồi mọi GET ngay, dùng `AUTH_CACHE_TTL_MS=0` và giữ cấu hình đó xuyên suốt các lượt so sánh.

## Việc cần chuẩn bị trước khi chạy

1. Cài Node phù hợp [package backend](../be/package.json), Docker và k6. Trên Windows có thể cài k6 bằng `winget install k6 --source winget`, sau đó mở terminal mới và chạy `k6 version`. Xem [hướng dẫn cài k6](https://grafana.com/docs/k6/latest/set-up/install-k6/).
2. Chạy `npm ci`, sinh Prisma Client, build và áp dụng migration mới vào DB test. Migration outbox phải có trước backend mới.
3. Dùng DB test riêng; đặt `NODE_ENV=test` và tắt rate limit **chỉ trên backend test**. Tắt email/Push thật trong các bài đo API.
4. Bật metrics, có token truy cập, ghi lại CPU/RAM, phiên bản Node/PostgreSQL/k6, vị trí backend/DB, số replica, pool, TTL và concurrency.
5. Lượt đầu dùng một backend để đọc metric của một tiến trình. Nếu chạy nhiều replica, scrape từng instance; không xem số liệu từ endpoint bị cân bằng tải giữa nhiều tiến trình như metric tổng của hệ thống. PM2 chung một cổng cần bổ sung cơ chế gộp metrics nếu muốn báo cáo toàn cluster.

Không cần thêm Redis, RabbitMQ hoặc nâng thư viện trước khi lấy số gốc. Nếu máy đang bị giới hạn CPU/RAM hoặc gói hosting tự ngủ, cần môi trường staging có tài nguyên ổn định để đánh giá mục tiêu 1000 người. Tăng CPU/RAM, số replica hoặc pool dựa trên số đo; không có cấu hình phần cứng cố định bảo đảm đạt.

## Chuẩn bị DB và môi trường PowerShell

Các lệnh dưới đây bắt đầu từ thư mục `be`. Ví dụ đường dẫn máy hiện tại:

```powershell
Set-Location E:/Seminar/Code/Seminar/be
node --version
docker version
k6 version
npm ci
npm run db:generate
npm run build
```

Khởi tạo một PostgreSQL test mới. Nếu tên container hoặc cổng đã được dùng, đổi tên/cổng trong toàn bộ ví dụ; không xóa môi trường cũ để lấy chỗ.

```powershell
docker run -d --name seminar-load-postgres `
  -e POSTGRES_PASSWORD=local_load_only `
  -e POSTGRES_DB=postgres `
  -p 127.0.0.1:55449:5432 `
  postgres:16-alpine `
  -c shared_preload_libraries=pg_stat_statements `
  -c track_io_timing=on
docker exec seminar-load-postgres pg_isready -U postgres
```

Đợi PostgreSQL báo nhận kết nối. Tạo file thiết lập môi trường dùng lại ở các terminal; các secret được sinh riêng và nằm trong thư mục test bị Git bỏ qua.

```powershell
New-Item -ItemType Directory -Force .tmp/load-test | Out-Null
@'
param(
  [ValidateSet('browse','deadline','review','phase','credentials','mixed')]
  [string]$Case = 'browse',
  [ValidatePattern('^[a-z0-9_]+$')][string]$RunId = 'r01',
  [string]$ApiOrigin = 'http://127.0.0.1:3001'
)
$script:RunDir = ".tmp/load-test/${Case}_${RunId}"
$script:DbName = "seminar_load_test_${Case}_${RunId}"
New-Item -ItemType Directory -Force $RunDir | Out-Null
$secretPath = Join-Path $RunDir 'secrets.json'
if (-not (Test-Path -LiteralPath $secretPath)) {
  @{
    jwt = (node -p "require('node:crypto').randomBytes(48).toString('base64url')")
    metrics = (node -p "require('node:crypto').randomBytes(48).toString('base64url')")
  } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $secretPath
}
$secrets = Get-Content -Raw -LiteralPath $secretPath | ConvertFrom-Json
$env:NODE_ENV = 'test'
$env:LOAD_TEST_DATABASE_URL = "postgresql://postgres:local_load_only@127.0.0.1:55449/$DbName"
$env:DATABASE_URL = $env:LOAD_TEST_DATABASE_URL
$env:JWT_SECRET = $secrets.jwt
$env:JWT_ISSUER = 'seminar'
$env:JWT_AUDIENCE = 'seminar-client'
$env:METRICS_ENABLED = 'true'
$env:METRICS_TOKEN = $secrets.metrics
$env:LOAD_TEST_MODE = $Case
$env:LOAD_TEST_USERS = '1000'
$env:LOAD_TEST_CRITERIA = '30'
$env:LOAD_TEST_FIXTURE_PATH = "$RunDir/users.json"
$env:LOAD_TEST_BASE_URL = $ApiOrigin
$env:LOAD_TEST_ALLOW_REMOTE = 'true'
$env:PORT = '3001'
$env:WEB_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
$env:CORS_ORIGINS = $env:WEB_ORIGINS
$env:PUBLIC_APP_URL = 'http://localhost:5173'
$env:RATE_LIMIT_ENABLED = 'false'
$env:ENABLE_DEMO_TOOLS = 'false'
$env:SWAGGER_ENABLED = 'false'
$env:EMAIL_ENABLED = 'false'
$env:EMAIL_PROVIDER = 'smtp'
$env:WEB_PUSH_ENABLED = 'false'
$env:ZALO_ZNS_ENABLED = 'false'
$env:STORAGE_ENABLED = 'false'
$env:REPORT_EXPORT_PROVIDER = 'local'
$env:CREDENTIALS_ENCRYPTION_KEY = ''
$env:BACKGROUND_JOBS_ENABLED = 'true'
$env:DB_POOL_MAX = '20'
$env:AUTH_CACHE_TTL_MS = '3000'
$env:DASHBOARD_CACHE_TTL_MS = '5000'
$env:NOTIFICATION_WORKER_CONCURRENCY = '5'
$env:CREDENTIAL_WORKER_CONCURRENCY = '5'
$env:WORKER_BUDGET_MS = '4000'
$env:UV_THREADPOOL_SIZE = '8'
'@ | Set-Content -Encoding UTF8 .tmp/load-test/set-env.ps1
```

Mỗi cặp `Case` và `RunId` tạo một DB và bộ kết quả riêng. Không dùng lại DB đã nộp hồ sơ cho lượt deadline tiếp theo. Script seed từ chối DB có user/đơn vị/kỳ hoặc file fixture đã tồn tại.

Ví dụ chuẩn bị kịch bản duyệt trang:

```powershell
. .tmp/load-test/set-env.ps1 -Case browse -RunId r01
docker exec seminar-load-postgres createdb -U postgres $DbName
if ($LASTEXITCODE -ne 0) { throw 'Không tạo được DB test mới' }
npm run db:migrate:deploy
if ($LASTEXITCODE -ne 0) { throw 'Migration thất bại' }
docker exec seminar-load-postgres psql -U postgres -d $DbName -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;'
npm run load:seed
if ($LASTEXITCODE -ne 0) { throw 'Seed thất bại' }
```

Fixture gồm 1000 UNIT, 20 ADMIN, 30 tiêu chí lá và JWT có hạn hai giờ. Các tài khoản dùng chung một hash đã tính sẵn, không cần đăng nhập và không bắt đổi mật khẩu. Đây là bài đo phiên đã xác thực; bài đăng nhập phải đo riêng. Tạo fixture sát giờ chạy để còn đủ hạn cho bài 30 phút.

Trên staging từ máy phát tải khác, thay `ApiOrigin` bằng origin API staging thực và cấu hình backend dùng cùng DB/JWT. Giữ kết nối DB của script qua loopback hoặc SSH tunnel tới DB test riêng. Chuyển file fixture sang máy phát tải bằng kênh riêng, giữ đúng đường dẫn `FIXTURE_PATH`; `BASE_URL` phải trùng `baseUrl` đã ghi trong fixture. Không đưa fixture hoặc file secret vào báo cáo công khai.

`ApiOrigin` phải trỏ tới backend staging, không phải domain FE Vercel. API `/api/v1/health` phải trả JSON của backend; HTML trang React với HTTP 200 không phải phản hồi health hợp lệ.

## Mở các terminal đo tải

### Terminal A chạy backend test

Mỗi terminal phải nạp **cùng Case và RunId**. Dừng backend cũ trước khi chuyển sang DB của lượt khác.

```powershell
Set-Location E:/Seminar/Code/Seminar/be
. .tmp/load-test/set-env.ps1 -Case browse -RunId r01
npm start 2>&1 | Tee-Object -FilePath "$RunDir/backend.log"
```

### Terminal B chạy k6

Kiểm backend và metrics trước, rồi lưu metadata của lượt chạy:

```powershell
Set-Location E:/Seminar/Code/Seminar/be
. .tmp/load-test/set-env.ps1 -Case browse -RunId r01
Invoke-RestMethod "$env:LOAD_TEST_BASE_URL/api/v1/health"
Invoke-WebRequest "$env:LOAD_TEST_BASE_URL/metrics" -Headers @{ Authorization = "Bearer $env:METRICS_TOKEN" } -UseBasicParsing | Select-Object StatusCode
git rev-parse HEAD | Set-Content "$RunDir/commit.txt"
node --version | Set-Content "$RunDir/node-version.txt"
k6 version | Set-Content "$RunDir/k6-version.txt"
$env:K6_WEB_DASHBOARD = 'true'
$env:K6_WEB_DASHBOARD_EXPORT = "$RunDir/k6-report.html"
$Fixture = '../../' + $env:LOAD_TEST_FIXTURE_PATH
```

k6 cung cấp dashboard tại `http://127.0.0.1:5665` và xuất HTML sau khi chạy. Nếu tiến trình chưa thoát dù bài đã xong, đóng tab dashboard. Đổi tên file HTML khi chạy lượt khác. Xem [tài liệu dashboard k6](https://grafana.com/docs/k6/latest/results-output/web-dashboard/).

### Terminal C thu metrics trong lúc tải

Chạy từ khoảng một phút trước k6, giữ trong suốt bài và thêm một phút sau khi dừng tải. Dùng Ctrl+C để dừng collector.

```powershell
Set-Location E:/Seminar/Code/Seminar/be
. .tmp/load-test/set-env.ps1 -Case browse -RunId r01
New-Item -ItemType Directory -Force "$RunDir/metrics" | Out-Null
while ($true) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  try {
    $sample = Invoke-WebRequest "$env:LOAD_TEST_BASE_URL/metrics" -Headers @{ Authorization = "Bearer $env:METRICS_TOKEN" } -UseBasicParsing
    $sample.Content | Set-Content -Encoding UTF8 "$RunDir/metrics/$stamp.prom"
  } catch {
    "$stamp METRICS_UNAVAILABLE" | Add-Content "$RunDir/metrics-errors.log"
  }
  docker stats --no-stream --format '{{json .}}' seminar-load-postgres | Add-Content "$RunDir/postgres-stats.jsonl"
  Start-Sleep -Seconds 10
}
```

Theo dõi riêng CPU/RAM và đường truyền máy phát tải. k6 bị nghẽn CPU, RAM hoặc mạng sẽ làm phép đo sai lệch; xem [hướng dẫn máy phát tải](https://grafana.com/docs/k6/latest/testing-guides/running-large-tests/). Collector và dashboard không thay thế kiểm tra dropped/interrupted iterations.

### Terminal D kiểm tra DB và hàng đợi

Chụp định kỳ khi tải ổn định, khi p95 tăng và tại mốc deadline:

```powershell
Set-Location E:/Seminar/Code/Seminar/be
. .tmp/load-test/set-env.ps1 -Case browse -RunId r01
Get-Content -Raw test/load/diagnostics.sql | docker exec -i seminar-load-postgres psql -U postgres -d $DbName -P pager=off | Tee-Object "$RunDir/db-diagnostics.txt" -Append
```

Truy vấn bổ sung, có thể chạy bằng `docker exec ... psql -c '<SQL>'` hoặc công cụ DB đang dùng:

```sql
SELECT count(*) AS pending_outbox, min(created_at) AS oldest_outbox
FROM notification_outbox WHERE processed_at IS NULL;

SELECT channel, status, count(*)
FROM notification_deliveries GROUP BY channel, status ORDER BY channel, status;

SELECT channel, status, count(*)
FROM credential_deliveries GROUP BY channel, status ORDER BY channel, status;

SELECT type, count(*),
       percentile_cont(0.95) WITHIN GROUP
         (ORDER BY extract(epoch FROM (d.sent_at - d.created_at))) AS delivery_p95_seconds
FROM notifications n JOIN notification_deliveries d ON d.notification_id = n.id
WHERE d.status = 'SENT'
GROUP BY type;
```

Trong truy vấn cuối cần phân biệt thời gian tạo hộp thư với thời gian ghi outbox: `sent_at - d.created_at` đo delivery sau khi fanout, còn thời gian toàn nghiệp vụ phải tính từ sự kiện/outbox. Khi email và Push bị tắt, không dùng trạng thái SKIPPED để kết luận đã giao thành công. `pg_stat_statements` cho mean/total query time; nó không trực tiếp cho p95 query.

## Chạy năm kịch bản riêng

Tạo DB/fixture mới bằng cách lặp phần chuẩn bị với `Case` tương ứng. Luôn dùng chung `Case` và `RunId` giữa backend, collector và k6. Trước bài chính, chạy một lượt riêng 10 VU để kiểm cấu hình; không dùng dữ liệu deadline đã bị lượt thử nộp hết cho bài chính.

### Duyệt và polling 1000 tài khoản

Case `browse`. Thử 10 VU trước bằng `HOLD_DURATION=1m`, `RAMP_DURATION=10s`; sau đó tạo lượt chính và chạy:

```powershell
k6 run -e SCENARIO=browse -e TARGET_VUS=1000 -e HOLD_DURATION=30m -e RAMP_DURATION=2m -e FIXTURE_PATH=$Fixture --summary-export "$RunDir/k6-summary.json" test/load/scenarios.k6.js 2>&1 | Tee-Object "$RunDir/k6-console.log"
$k6Exit = $LASTEXITCODE
$k6Exit | Set-Content "$RunDir/k6-exit-code.txt"
```

Mỗi VU đọc danh sách kỳ, hồ sơ, chi tiết và số thông báo rồi nghỉ khoảng 30 giây. Tải lý thuyết khoảng `1000 × 4 / 30 ≈ 133 request/s` khi đáp ứng rất nhanh; giá trị thực giảm khi thời gian phản hồi tăng. Đây là mô hình tải đóng, không phải cam kết tạo một RPS cố định. Xem [mô hình mở và đóng của k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/).

### Lưu 30 ô và nộp trong 5 phút

Case `deadline`, DB mới. Lượt thử dùng RunId khác, `TARGET_VUS=10` và `SPREAD_SECONDS=1`. Lượt chính:

```powershell
k6 run -e SCENARIO=deadline -e TARGET_VUS=1000 -e SPREAD_SECONDS=240 -e FIXTURE_PATH=$Fixture --summary-export "$RunDir/k6-summary.json" test/load/scenarios.k6.js 2>&1 | Tee-Object "$RunDir/k6-console.log"
$LASTEXITCODE | Set-Content "$RunDir/k6-exit-code.txt"
npm run load:verify
if ($LASTEXITCODE -ne 0) { throw 'Kiểm tra dữ liệu sau tải không đạt' }
Copy-Item -LiteralPath .tmp/load-test/integrity.json -Destination "$RunDir/integrity.json"
```

Script kiểm lỗi từng ô trước khi nộp. Fixture giữ lịch mở hai giờ để tách tải ghi khỏi race deadline; đây là **lưu/nộp trải trong 5 phút**, chưa phải phép thử đồng hồ thật tại biên deadline. Kiểm thêm đủ 1000 hồ sơ `PENDING_REVIEW` và `submitted_at IS NOT NULL`. Ca deadline/scheduler cạnh tranh được kiểm trong integration; muốn nghiệm thu dưới tải tại biên giờ cần bài bổ sung riêng, không sửa đồng hồ máy.

### Thẩm định song song với 1000 người đọc

Case `review`, DB mới. Seed điền đủ điểm tự chấm và đưa hồ sơ vào giai đoạn thẩm định lần đầu.

```powershell
k6 run -e SCENARIO=review -e TARGET_VUS=1000 -e ADMIN_VUS=20 -e HOLD_DURATION=30m -e FIXTURE_PATH=$Fixture --summary-export "$RunDir/k6-summary.json" test/load/scenarios.k6.js 2>&1 | Tee-Object "$RunDir/k6-console.log"
$LASTEXITCODE | Set-Content "$RunDir/k6-exit-code.txt"
```

Đọc riêng p95 của `accept_all_scores` và `complete_first_review`, không chỉ p95 gộp với nhiều GET. Sau khi một vòng đã xử lý hết hồ sơ, thao tác lặp có thể trở thành idempotent và nhẹ hơn lượt đầu; giữ số liệu lượt đầu khi đánh giá khả năng ghi.

Kịch bản review dùng một executor với tổng 1020 VU, phân vai 20 ADMIN và 1000 UNIT theo dải ID riêng. Cả hai nhóm cùng ramp và cùng thời gian giữ tải; tránh ánh xạ ID toàn cục của nhiều scenario vào một danh sách UNIT.

### Chuyển phase với 1000 hồ sơ

Case `phase`, DB mới. Dừng backend của lượt này hoặc tắt background job để scheduler tự chạy không giành công việc của phép đo trực tiếp.

```powershell
npm run load:jobs -- phase 2>&1 | Tee-Object "$RunDir/phase-console.log"
$LASTEXITCODE | Set-Content "$RunDir/phase-exit-code.txt"
```

Đọc file `users.json.phase-result.json` cạnh fixture: `processingMs` là thời gian xử lý scheduler, `fanoutMs` là thời gian materialize outbox. Script kiểm trạng thái của mọi hồ sơ. Với 20 ADMIN và 1000 UNIT, auto-lock có thể tạo thêm 20000 notification gửi tới admin ngoài 1020 thông báo đổi phase. Đây là fanout lớn hơn nhiều so với chỉ 1000 thông báo đơn vị.

Bài này không gọi provider thật, nên không kết luận được email đến hộp thư nhanh hay chậm. Nếu đo với DB khác máy, giữ cùng vị trí mạng giữa hai lượt so sánh.

### Cấp credential với provider giả

Case `credentials`, DB mới. Dừng backend của lượt này để không có worker khác nhận cùng hàng đợi.

```powershell
$env:LOAD_TEST_CONCURRENCY = '5'
$env:LOAD_TEST_PROVIDER_MS = '50'
npm run load:jobs -- credentials 2>&1 | Tee-Object "$RunDir/credential-console.log"
$LASTEXITCODE | Set-Content "$RunDir/credential-exit-code.txt"
```

Đọc `users.json.credentials-result.json`: đủ 2000 delivery SENT, thời gian xử lý, peak concurrency. Provider giả mô phỏng độ trễ bằng timer; phép đo kiểm worker/DB, không tiêu hạn mức email/Push. Chạy riêng các lượt concurrency 1, 5 hoặc 10 trên DB mới nếu muốn chọn cấu hình. Không tăng concurrency giữa một lượt đo.

Nếu cần gửi thật, cấu hình Resend HTTPS, sender hợp lệ và nhóm địa chỉ đã kiểm soát; bắt đầu tốc độ thấp theo hạn mức của tài khoản. Không dùng 1000 địa chỉ giả của fixture để thử giao email thật.

### Bài tương tác có ghi điểm thường xuyên

Case `mixed` dùng [workload.k6.js](../be/test/load/workload.k6.js): 80% đọc, 20% ghi, nghỉ 1–3 giây. Đây là bài bổ sung nặng hơn polling, có ngưỡng riêng p95 đọc 800 ms và ghi 1500 ms.

```powershell
k6 run -e TARGET_VUS=1000 -e HOLD_DURATION=10m -e FIXTURE_PATH=$Fixture --summary-export "$RunDir/k6-summary.json" test/load/workload.k6.js
npm run load:verify
```

## Đọc số liệu trong lúc chạy

| Số liệu | Nơi xem | Cách diễn giải |
| --- | --- | --- |
| VU, RPS, lỗi, p95 đọc/ghi | k6 dashboard, console và summary | Kiểm cả tải thực đạt được; không chỉ nhìn lỗi thấp |
| p95 API theo route | Histogram `seminar_http_duration_seconds` | Route dùng template, tránh URL chứa ID người dùng |
| p95 query | `seminar_db_query_duration_seconds` | Tính qua histogram, khác thời gian HTTP toàn request |
| Chờ pool | `seminar_db_connections{state="waiting"}` | Tăng kéo dài: đối chiếu DB CPU, lock và số connection trước khi tăng pool |
| p99 event loop | `seminar_event_loop_lag_p99_seconds` | Nhân 1000 thành ms; mỗi mẫu đại diện cửa sổ 10 giây, không phải p99 toàn lượt |
| CPU và RAM Node | `process_cpu_seconds_total`, `process_resident_memory_bytes` | Đọc CPU bằng rate; RSS là byte cần chia ra MiB |
| Lock wait | `pg_stat_activity`, `pg_blocking_pids`, `pg_locks` | Xác định PID chặn và transaction giữ lâu |
| Query tổng thời gian cao | `pg_stat_statements` | So sánh calls, mean time và total time; không đồng nhất mean với p95 |
| Queue và retry | Các truy vấn ở Terminal D | Queue cần giảm sau đợt gửi; FAILED/SKIPPED không đồng nghĩa gửi thành công |

Nếu có Prometheus/Grafana, dùng các truy vấn sau. Backend xuất **giây**, k6 thường báo **mili giây**.

```promql
# p95 HTTP theo route trong 5 phút
histogram_quantile(0.95,
  sum by (le, route) (rate(seminar_http_duration_seconds_bucket[5m])))

# p95 query DB trong 5 phút
histogram_quantile(0.95,
  sum by (le) (rate(seminar_db_query_duration_seconds_bucket[5m])))

# CPU của tiến trình tính theo phần trăm một core
100 * rate(process_cpu_seconds_total[1m])

# RAM của tiến trình tính theo MiB
process_resident_memory_bytes / 1024 / 1024
```

Prometheus cần scrape endpoint `/metrics` với Bearer token, chẳng hạn `authorization.credentials_file` trỏ tới file token private. Các snapshot `.prom` chỉ là bản ghi tức thời; muốn dùng `rate` và cửa sổ 5 phút, cần một hệ thống lưu time series như Prometheus.

## Đo giao diện trong lúc k6 đang chạy

k6 HTTP không render React. Dùng bản FE đã build thay vì dev server khi đánh giá trải nghiệm:

```powershell
# Terminal riêng, bắt đầu trong be sau khi nạp môi trường đúng lượt
$env:VITE_API_URL = $env:LOAD_TEST_BASE_URL
Set-Location ../fe
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 5173
```

Các tài khoản seed không có mật khẩu để đăng nhập thủ công. Có thể mở phiên test bằng JWT thật trong fixture: tại terminal private, đọc fixture bằng `ConvertFrom-Json`, rồi chuyển `$fixture.units[0].token` hoặc `$fixture.admins[0].token` vào clipboard. Không in toàn bộ fixture vào log.

```powershell
$fixture = Get-Content -Raw -LiteralPath $env:LOAD_TEST_FIXTURE_PATH | ConvertFrom-Json
$fixture.units[0].token | Set-Clipboard
```

Trong DevTools Console **của đúng FE test**, dùng token test để khôi phục phiên. Backend vẫn kiểm chữ ký và quyền qua `auth/me`:

```javascript
const token = prompt('JWT của tài khoản trên DB test riêng');
if (token) {
  sessionStorage.removeItem('refreshToken');
  sessionStorage.removeItem('currentUser');
  sessionStorage.removeItem('sessionExpiresAt');
  sessionStorage.setItem('accessToken', token);
  location.assign('/unit/records'); // ADMIN: /admin/dashboard
}
```

Quan sát mở hồ sơ, cuộn bảng, đổi trang và dashboard khi k6 đang tải ổn định. Với các tài khoản đang được k6 dùng, ưu tiên đọc; thao tác sửa/nộp thủ công có thể làm thay đổi dữ liệu bài đo. Dùng Chrome Performance/Live metrics cho tương tác thực và lưu trace; chạy Lighthouse để đo tải trang. Lighthouse một lượt không tự cung cấp INP hiện trường của 1000 người.

Mốc tham khảo Core Web Vitals ở p75: LCP ≤ 2,5 giây, INP ≤ 200 ms, CLS ≤ 0,1, theo [hướng dẫn Google](https://web.dev/articles/vitals). Các trace trong phòng thử là bằng chứng lab, không thay thế thống kê người dùng thực ở p75.

Header cache cần kiểm trên bản triển khai thật qua Nginx/Vercel; Vite preview không xác nhận cấu hình header của hai nơi đó:

```powershell
curl.exe -I 'https://<staging-fe>/assets/<file-co-hash>.js'
```

Assets cần `public`, `max-age=31536000`, `immutable`; HTML không cache dài. Kiểm cold cache và warm cache riêng, giữ cùng thiết bị/mạng/throttling khi so sánh.

## Tiêu chí chốt kết quả và cách chọn nâng cấp

Ngưỡng khởi điểm của [scenarios.k6.js](../be/test/load/scenarios.k6.js): HTTP lỗi dưới 1%, checks trên 99%, p95 đọc dưới 1000 ms và ghi dưới 2000 ms ở kịch bản có ghi. Bài `mixed` dùng ngưỡng chặt hơn. Chốt ngưỡng với người nghiệm thu trước khi chạy và không đổi ngưỡng giữa các lượt. [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) quyết định trạng thái đạt/không đạt của bài đo.

Ngoài ngưỡng k6, kiểm event loop p99 dưới 100 ms, không thiếu/nộp nhầm dữ liệu, không deadlock, không restart/OOM và hàng đợi giảm sau đợt gửi. Riêng deadline phải xác nhận đủ 1000 tài khoản đã lưu/nộp; trung bình nhanh và lỗi thấp không bù cho các VU chưa chạy xong.

Script yêu cầu `script_errors=0`; lỗi runtime sẽ dừng bài đo thay vì quay vòng mà không gửi request. Deadline có thêm `completed_evaluations >= TARGET_VUS` để không báo đạt khi thiếu lượt nộp. Browse không đánh giá p95 ghi vì kịch bản không có thao tác ghi.

| Hiện tượng | Việc kiểm tiếp |
| --- | --- |
| p95 cao, lock wait tăng | Transaction/PID chặn, scheduler và luồng thay đổi cấu hình |
| Pool waiting tăng, DB còn rảnh | Tổng connection của mọi tiến trình, thời gian giữ connection; thử pool mới ở lượt khác |
| DB CPU/I/O cao | Query, index, kế hoạch thực thi và tài nguyên DB; không tăng pool theo phản xạ |
| Node CPU/event loop cao, DB rảnh | Profile CPU, tải login/native bcrypt, CPU dành cho Node |
| Queue tăng nhưng HTTP ổn | Concurrency, timeout, rate limit provider và lease; phân biệt enqueue với giao thật |
| k6 CPU/mạng bão hòa hoặc thiếu iterations | Sửa máy phát tải trước khi quy lỗi cho backend |
| API nhanh nhưng giao diện giật | Main thread trình duyệt, render bảng, chunk và cache thực tế |

Redis/pooler trở nên hữu ích khi chạy nhiều replica và cần rate limit/invalidation chung hoặc giới hạn tổng connection. Chúng không thay thế việc xác định query/lock/CPU đang nghẽn. Không bắt buộc cài thêm trước lượt baseline một instance.

Sau mỗi lượt, giữ `Case`, RunId, commit, cấu hình tài nguyên, file k6 summary/HTML, exit code, metrics, DB snapshot, integrity và trace trình duyệt. Chạy lại mỗi kịch bản ít nhất ba lượt với DB tương đương; báo từng lượt cùng khoảng dao động. Không lấy số VC17 của 34 người làm số trước/sau trực tiếp cho 1000 người.

Mẫu ghi kết quả:

| Lượt | Case | VU thực đạt | RPS | Lỗi | p95 đọc ms | p95 ghi ms | Event loop p99 ms | CPU/RAM | Dữ liệu/queue | Kết luận |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r01 | browse | Điền sau đo | | | | Không áp dụng | | | | |
| r01 | deadline | Điền sau đo | | | | | | | | |
| r01 | review | Điền sau đo | | | | | | | | |

Để tắt bài đo, dừng k6/collector/backend/FE bằng Ctrl+C. Có thể dừng container test bằng `docker stop seminar-load-postgres` sau khi lưu kết quả. Chỉ kết luận hệ thống đạt 1000 tài khoản đồng thời khi số đo và dữ liệu của các kịch bản mục tiêu đáp ứng tiêu chí trên đúng môi trường sẽ vận hành.
