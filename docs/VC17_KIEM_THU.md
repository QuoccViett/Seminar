# VC17 — Kiểm thử toàn hệ thống và dữ liệu cạnh tranh

**Hiện trạng 24/11/2026:** VC17 kỹ thuật đã đạt trên [CI 45248745539](https://github.com/giahan358/Seminar/actions/runs/45248745539), đúng commit `ab8c047e87e1ef19f6432c5bad830b4d8d2bfd59`, sau triển khai lịch hai mốc, generator Excel và ngưỡng tùy chỉnh. Cả bốn job xanh; artifact đã đối chiếu checksum, manifest `complete=true`, 42/42 bước không fail/skip, browser 20/20 không mock; coverage 96,19% dòng/89,95% nhánh. Xem [biên bản hiện hành](./HOAN_THIEN_2026-11-24.md). Supabase thật/hạ tầng/thiết bị và hai lần diễn tập thuộc điều kiện VC10/18/20 đang mở.

Phần kết quả và chẩn đoán ngày 19/11 bên dưới là lịch sử tại baseline `main`/`cccf167`: khi đó còn chờ CI fixture VC11 và quyết định lịch tạm. Quy tắc lịch tạm đã được thay bằng phản hồi 23/11 và source mới 24/11; không đọc các giới hạn cũ thành trạng thái hiện hành.

## Môi trường và cách chạy

Đã kiểm Git, source/Auth, schema Prisma, 11 migration, API contract và FE trước khi sửa. Giữ NestJS + Prisma + PostgreSQL 16 và ESM. Các bộ dùng DB mới trên PostgreSQL loopback riêng; runner kiểm tất cả tên đích chưa tồn tại trước khi tạo, không DROP/reset DB hoặc sửa migration đã áp dụng. Mailpit 1025/8025 chỉ nhận địa chỉ thử `example.invalid`; ZNS tắt. Không gửi tới người thật hoặc deploy.

Sau `npm ci`, `npm ci --prefix ../fe`, `npm run db:generate`, `npx playwright install chromium` (Linux thêm `--with-deps`), chạy từ backend:

```powershell
docker run -d --name seminar-vc17-local -e POSTGRES_USER=vc17 -e POSTGRES_PASSWORD=vc17_test -e POSTGRES_DB=vc17_control_test -p 127.0.0.1:55438:5432 postgres:16-alpine -c shared_preload_libraries=pg_stat_statements -c log_min_duration_statement=250 -c track_io_timing=on
docker run -d --name seminar-vc17-local-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce
docker exec seminar-vc17-local pg_isready -h 127.0.0.1 -U vc17 -d vc17_control_test
$env:VC17_ADMIN_DATABASE_URL='postgresql://vc17:vc17_test@127.0.0.1:55438/vc17_control_test'
npm run test:vc17
```

Tên container/cổng trong ví dụ phải còn trống; có thể dùng Mailpit thử đã chạy trên loopback thay vì tạo trùng. URL chỉ nhận localhost/127.0.0.1, DB quản lý `vc17_control_test`. Chạy lại `pg_isready` tới khi thành công rồi mới chạy test. Nếu các DB đích đã tồn tại, tạo PostgreSQL thử mới, không reset. Job `system-vc17` trong [workflow](../.github/workflows/ci.yml) tự dựng các điều kiện này và chạy cùng entrypoint. Khi chẩn đoán bộ riêng, đặt `VC17_SUITES` và gọi `node scripts/run-vc17.mjs`; lượt chọn bộ không thay thế kiểm coverage của toàn bộ unit/HTTP lõi.

Log/manifest ở `be/.tmp/vc17-artifacts`, coverage ở `be/.tmp/vc17-coverage`, ảnh/kết quả browser ở `be/.tmp/vc16-artifacts`. State browser có credential fixture không nằm trong danh sách upload artifact. Lượt tổng hợp đầu giữ riêng tại `be/.tmp/vc17-first-run-artifacts`; kết quả kiểm lại phải đọc cùng log lỗi ban đầu, không coi lỗi là đạt.

## Kết quả thực tế cuối lượt

| Phép kiểm | Kết quả |
|---|---|
| `npm run test:unit` BE, gồm cả `.spec.ts` và `.spec.js` | 217/217, không bỏ qua |
| 19 bộ DB/HTTP/seed/upgrade VC03–VC15 và VC17 | Tổng hợp 54/54, không bỏ qua; VC12 11/11, VC13 9/9, VC15 9/9, VC17 system 9/9 |
| Timezone | 7/7 ở từng TZ UTC, Asia/Ho_Chi_Minh, America/New_York |
| Policy và route ID | 864 tổ hợp; đủ 56 route ID từ metadata Nest |
| Browser trên Nest/PostgreSQL/storage thật | Hai lượt liên tiếp 19/19 trên DB mới ở cổng PostgreSQL 55436 và 55437, `mockBackend=false` |
| Coverage unit/HTTP lõi | 5.849/6.173 dòng = **94,75%**, nhánh **88,45%**, hàm **96,02%**; `report --check-coverage` đạt ngưỡng 85% |
| Tải không profiler | 34 UNIT × 3 cặp lưu + dashboard = 204 HTTP, 0 lỗi; p95 cặp **7.830 ms**, tối đa **8.186 ms**, ngưỡng local xác định trước tải **18.714 ms**; CI đặt 15.000 ms |
| Thống kê DB trong cửa sổ tải | 2.857 lượt truy vấn; một nhóm query ID có max ít nhất 250 ms; lưu ID/calls/tổng/max, không xuất SQL/tham số |
| BE lint/build/TypeScript, Prisma validate | Đạt |
| FE lint/build và `npm test` | Đạt, 43/43 trên 16 tệp |
| Comment, workflow, whitespace | 82 khối comment thêm/sửa không có lỗi tiếng Việt hoặc dấu chấm cuối dòng; YAML và `git diff --check` đạt |

Bằng chứng máy đọc được tại [verification-summary.json](../be/.tmp/vc17-artifacts/verification-summary.json), coverage tại [báo cáo c8](../be/.tmp/vc17-coverage/index.html), hai lượt UI tại [lượt một](../be/.tmp/vc17-artifacts/browser-first-pass.json) và [lượt hai](../be/.tmp/vc17-artifacts/browser-second-pass.json). Đây là **kết quả tổng hợp các lần chạy**, không khẳng định lượt toàn bộ đầu tiên đã xanh: log lỗi ban đầu được giữ, từng bộ lỗi được kiểm lại sau xử lý, các bộ đã đạt không bị thay bằng kết quả giả. Lượt cuối VC15/system/browser cùng đạt; browser sau đó được lặp lại trên DB mới.

Unit/HTTP lõi cung cấp bộ đếm V8; các tiến trình PDF/tải/browser không gắn profiler nhưng mọi source nghiệp vụ vẫn nằm trong mẫu số. Báo cáo local bỏ dữ liệu bộ đếm của sáu tiến trình nặng đã thử trước khi tách profiler, đồng thời bỏ dependency/test/generated theo cấu hình; giữ raw ban đầu để đối chiếu, không sửa bộ đếm mã sản phẩm. Không dùng báo cáo cũ tính cả tệp test 83,36% để kết luận đạt.

Cảnh báo không làm thất bại kiểm: JSDOM chưa hỗ trợ pseudo-element của `getComputedStyle`, Vite cảnh báo chunk lớn hơn 500 kB và pg cảnh báo API query đồng thời sẽ thay đổi ở bản lớn tương lai. Lượt kiểm local trước đó đã đạt; lỗi thiết lập CI phát hiện sau khi mở PR #31 được ghi riêng dưới đây, không dùng bằng chứng local để khẳng định remote đã xanh.

## Ma trận bằng chứng

| Điều kiện VC17 | Phép kiểm và hậu điều kiện |
|---|---|
| Quyền/giờ/trạng thái | [Policy](../be/src/modules/evaluations/vc17-policy.spec.ts) kiểm 864 tổ hợp phase/status/time/published/requested và lịch thiếu; [system](../be/test/integration/vc17.system.test.ts) lấy mọi route ID từ metadata Nest để thử không phiên/sai vai trò/UNIT khác; VC08–VC13 kiểm chưa công bố/chưa mở/đúng biên/sau chốt |
| Golden path | Workbook thật → preview/confirm → login `123456`, BE bắt đổi → publish/chưa mở/không lộ tiêu chí → mở → self/PDF thật → submit/review → hai nhánh supplement submitted/expired → finalize/dashboard/history/audit → tải XLSX/PDF/DOCX |
| Refresh/import/publish | Refresh cùng token chỉ một thành công, reuse thu hồi mọi token còn hiệu lực; VC07 confirm cùng phiên và hai phiên trùng không tạo user/unit/dispatch lặp; VC08 publish cạnh tranh kiểm hồ sơ/tiêu chí/outbox |
| Save/submit/expiry/finalize | VC09 save-vs-submit; VC12 save-vs-supplement-submit, chờ khóa qua deadline cùng scheduler, hai finalize; kiểm điểm/trạng thái/số history/outbox sau race |
| Worker/reset | VC05 SKIP LOCKED/backoff/token cũ; VC11 tiến trình khởi động lại sau lease/cửa sổ; VC17 hai worker tranh cùng retry chỉ gọi provider một lần, hai audit cho hai attempt; reset-vs-credential kiểm cả hai thứ tự và xác nhận reset thực sự chờ khóa user |
| Contract/dữ liệu | Lỗi đúng statusCode/code/message/details và tiếng Việt; không raw Prisma/SQL/provider/secret; UNIT chưa chốt không nhận điểm Admin/baseline; nested validation có chỉ số, không phản chiếu input; mass assignment không đổi DB |
| Migration/seed/kiểu | Migrate deploy DB trống đủ 11 migration; upgrade VC12/13 và nền 9 → 11 tại VC17 giữ snapshot hạn cũ/Auth/score/evidence/audit/history; append-only/baseline/view còn hiệu lực; seed hai lần idempotent; UTC mili giây/Decimal 85,01/BigInt 9007199254740993 round-trip |
| Tải | 34 UNIT, mỗi người ba lượt lưu + đọc dashboard ADMIN, 204 HTTP; kiểm điểm/note cuối của từng người, số lỗi/p95 và query ID/calls/thời gian, không xuất SQL/tham số |
| Coverage | c8 gộp unit/HTTP lõi, remap source map; mọi service nghiệp vụ, generator báo cáo, policy, guard/filter/validation/serializer/helper quan trọng vẫn thuộc mẫu số kể cả chưa chạy; loại test/generated, thất bại nếu dưới 85% dòng; PDF/tải/browser chạy chức năng không profiler |
| Browser | Vite + Nest + PostgreSQL/storage thật; kiểm kéo thả Excel, mật khẩu 7/8, chưa mở tiêu chí, nháp/mạng chậm/lỗi mạng, upload, bổ sung/thẩm định/chốt, tải tệp, giao diện nhỏ và hết phiên |

### Regression mục 10.4 và lịch tạm mục 5.4

| Nhóm | Bằng chứng mới |
|---|---|
| Password | VC17 HTTP: 7/8/9/10+, Unicode, 72/73 byte, username/hash cũ/phổ biến, thu hồi access; browser 7 bị chặn trước HTTP, 8 được BE/DB chấp nhận |
| Tự chấm | VC08/09/policy kiểm start−1/start/deadline, cuối tuần/ngoài giờ, PATCH ghép lịch và scheduler trễ |
| Lịch bổ sung | Calculator/review-policy và VC08/12/16 kiểm năm ví dụ, thứ Sáu 23:30/23:59, cuối tuần, start và trọn phút 23:59 tới deadline 00:00 |
| Tháng/năm/TZ | Cùng bảy test lịch chạy ở UTC, Asia/Ho_Chi_Minh, America/New_York; 31/12 → 01/01, instant UTC khác ngày Việt Nam |
| Helper/lịch sai | Unit calculator và DTO HTTP kiểm Date/ISO/offset/lịch sai, lặp không mutate và từ chối trường số giờ cũ |
| Request/retry | VC12 kiểm requestedAt khác startAt, hai request, rollback, retry, snapshot/outbox không dời |
| Quyền/API/DB | VC09/10/12/policy/route ID kiểm owner/mục/file/confirm muộn/biên giờ, trigger nguyên vẹn |
| Expiry/Admin | VC11/12 kiểm job trễ/restart/hai worker/nộp sớm/hồ sơ khác còn mở; không tự finalize hoặc đổi SUBMITTED thành EXPIRED |
| Reminder | VC05/06/11 kiểm trước mở/sau đóng/retry, giờ VN, không quảng bá đủ 48 giờ cho lịch mới |
| Migration | Fresh DB, upgrade VC12/13/17, seed idempotent và giữ dữ liệu/hạn cũ |
| Golden path | VC17 API và browser VC16 chạy lại, phân biệt fake provider với SMTP Mailpit thật |

Lịch bổ sung vẫn là **phương án tạm ngày 17/11/2026, chờ hỏi thầy**. Không tính bằng `supplementHours`; không áp holiday chưa xác nhận; tự chấm mọi ngày/giờ; FE lấy quyền từ BE. Upgrade giữ hạn đã gửi theo lịch cũ, không âm thầm đổi snapshot của yêu cầu đang mở. Không dùng kết quả VC01–VC03 cũ thay cho các regression trên.

## Các vấn đề phát hiện và xử lý

1. Publish nhiều đơn vị và reset chờ credential worker có thể vượt timeout mặc định 5 giây trên máy chậm. Cập nhật [contract](API_CONTRACT.md) trước, đặt transaction publish/reset timeout 30 giây/maxWait 10 giây; giữ khóa user/credentialVersion và các chặn bảo mật.
2. DB thử mới dùng lại kho báo cáo cũ làm phép kiểm mồ côi VC15 đếm 22 thay vì 1. [Harness](../be/test/integration/vc12-support.ts) tạo kho theo UUID mỗi lượt, giữ assertion nghiêm ngặt, không xóa kho của DB cũ.
3. Metadata route có suffix `/` làm bộ kiểm chọn sai body và nhận 400 trước khi tới scope. Chuẩn hóa mọi dấu kết thúc, vẫn yêu cầu 403/404 thay vì nới assertion để che lỗi.
4. Browser ngắt mạng khi vừa điều hướng, trước khi tải xong dữ liệu; Date.now thử lệch giờ còn tác động tới kiểm JWT phía sau. Khôi phục đồng hồ sau assertion quyền, đợi response thật/tải xong và chỉ ngắt request lưu cần kiểm. Không fulfill response backend giả.
5. Lượt đầu VC11 tiến trình con không hoàn tất và migration recovery P1001 khi máy thiếu RAM. Giữ log, kiểm lại trên DB mới sau khi ngừng các phép phân tích nặng chạy song song; không coi lỗi môi trường là kết quả đạt.
6. Vite kế thừa nhầm `NODE_ENV=test` của backend làm thư viện rc-component gán mọi ID ARIA thành `test-id`: modal hiện nhưng không có tên truy cập đúng. Tách `NODE_ENV=development` cho Vite; phép kiểm tập trung xác nhận tên modal có đúng một ID và được tìm thấy theo role/name. Giữ assertion bàn phím, dùng Chromium đầy đủ ở headless mới để có bộ xem PDF.
7. Lệnh unit cũ chỉ tìm `.spec.ts`, bỏ qua năm test dashboard `.spec.js` đã có trong Git. Bổ sung danh sách hậu tố cho runner/npm/VC17, giữ tương thích lệnh E2E cũ; cả năm test dashboard và hai test policy mới đều đã chạy đạt.
8. Một lượt feedback trong VC15 trả 500 khi gắn profiler; chạy độc lập không profiler đạt 9/9 trong 29 giây. Runner tách thu bộ đếm V8 khỏi PDF, tải và browser; mọi assertion chức năng và toàn bộ source trong mẫu số coverage được giữ nguyên. Báo cáo coverage dùng `report --check-coverage` với remap; lệnh con `check-coverage` riêng của c8 12 không truyền `excludeAfterRemap`, nên không dùng lệnh con đó để kiểm source TypeScript đã build.

## Tệp thêm/sửa

- CI/điều phối: [workflow](../.github/workflows/ci.yml), [runner VC17](../be/scripts/run-vc17.mjs), [runner unit/E2E](../be/scripts/run-tests.mjs), [c8](../be/.c8rc.vc17.json), [package](../be/package.json), [lockfile](../be/package-lock.json), [ESLint](../be/eslint.config.js)
- Nghiệp vụ/contract: [publish service](../be/src/modules/evaluation-periods/evaluation-periods.service.ts), [users service](../be/src/modules/users/users.service.ts), [contract](API_CONTRACT.md)
- Kiểm thử: [policy](../be/src/modules/evaluations/vc17-policy.spec.ts), [dashboard](../be/src/modules/dashboard/dashboard.service.spec.js), [system](../be/test/integration/vc17.system.test.ts), [upgrade](../be/test/integration/vc17.migration.test.ts), [import](../be/test/integration/vc07.import.test.ts), [harness](../be/test/integration/vc12-support.ts), [browser](../be/test/browser/vc16.frontend.mjs)
- Tài liệu: [hướng dẫn browser](VC16_FRONTEND.md), biên bản này và [checklist/tiến độ](../../../TaiLieu/KE_HOACH_VIBE_CODING_TOAN_BO_DO_AN.md)

## Sửa hai lỗi CI của PR #31 ngày 19/11/2026

[Run 44456568911](https://github.com/giahan358/Seminar/actions/runs/44456568911) thất bại ở bước generate của `system-vc17` và job Gitleaks trên commit `47c572a`. Các cảnh báo npm deprecated/audit trong log không phải nguyên nhân hai lỗi này; không chạy `npm audit fix --force` hoặc nâng dependency ngoài phạm vi.

- [Workflow](../.github/workflows/ci.yml) truyền `DATABASE_URL` từ `VC17_ADMIN_DATABASE_URL` chỉ vào bước cài dependency/generate. Prisma cần URL khi nạp cấu hình, dù PostgreSQL chưa khởi tạo và generate không kết nối DB. Giữ nguyên cấu hình Prisma bắt buộc biến môi trường; URL chỉ dành container thử loopback, không lấy secret hay DB demo.
- [Golden path](../be/test/integration/vc17.system.test.ts) sinh mật khẩu mới từ 18 byte ngẫu nhiên mỗi lượt, giữ kiểm đổi từ `123456`, đối chiếu bcrypt, bắt đổi mật khẩu và purge credential. Mật khẩu 42 byte đáp ứng chính sách nhưng không được ghi log/báo cáo.
- [Gitleaks ignore](../.gitleaksignore) chỉ thêm fingerprint chính xác của literal fixture trong commit cũ, vì scanner vẫn đọc dòng đã tồn tại trong lịch sử. Không bỏ qua cả tệp test hoặc tắt `generic-api-key`.

Kiểm thực tế của bản sửa: tái hiện generate thiếu URL thất bại mã 1; cấp URL thử khi chưa có PostgreSQL thì generate thành công mã 0; actionlint 1.7.7 kiểm workflow đạt; TypeScript `--noEmit` và lint BE đạt. Gitleaks 8.24.3 quét đúng dải `47c572a^..47c572a`, tệp system hiện tại và các dòng thêm mới đều không phát hiện leak. Quét thư mục tùy ý có cả tệp local bị Git bỏ qua nên không tương đương job quét lịch sử Git; không dùng kết quả đó để khẳng định toàn thư mục sạch.

Chạy lại toàn bộ [system](../be/test/integration/vc17.system.test.ts) sau sửa trên PostgreSQL 16 riêng cổng 55448, DB mới áp đủ 11 migration: **9/9 đạt, 0 fail/skip**, khoảng 69,85 giây. Bao gồm golden path dùng mật khẩu ngẫu nhiên và tải 34 người/204 HTTP, p95 5.149 ms/cặp lưu + dashboard dưới ngưỡng cấu hình trước 15.000 ms, 0 lỗi. [TAP](../be/.tmp/vc17-ci-fix/system.tap) và [hậu điều kiện](../be/.tmp/vc17-ci-fix/system-results-after.json) lưu riêng khỏi bằng chứng lượt trước; container thử được dừng sau kiểm. `git diff --check` đạt; rà tám dòng comment mới đều có tiếng Việt có dấu và không kết thúc bằng dấu chấm.

Kết quả remote sau bản sửa hai lỗi đầu tiên được ghi ở mục tiếp theo. Không thay đổi schema, migration đã áp dụng, API contract hoặc FE trong bản sửa này.

## Sửa fixture scheduler VC11 thiếu cấu hình trên CI

Baseline `0a1252a`, Git sạch trước lượt sửa. [Run thực tế 44459025787](https://github.com/giahan358/Seminar/actions/runs/44459025787) đã qua Gitleaks, Backend CI, Frontend CI và 41/42 bước nội bộ VC17; riêng `vc11` thất bại, manifest `complete=false`. Coverage remote 96,14% dòng đạt ngưỡng nhưng không thay thế kết quả test thất bại. URL của run `44456568911` trong log được gửi lại là lượt cũ; dùng run mới tương ứng commit để đối chiếu.

Đã đọc artifact `vc17-evidence` ID `14499611327`, đối chiếu SHA-256 của ZIP tải về khớp digest từ [metadata artifact GitHub](https://api.github.com/repos/giahan358/Seminar/actions/artifacts/14499611327). [Log VC11 remote](../be/.tmp/vc17-scheduler-ci/remote/vc17-artifacts/vc11.log) chỉ ghi tiến trình thoát mã 1 sau khoảng 3,14 giây vì Nest mặc định tự thoát khi khởi tạo lỗi và test đã tắt logger.

Nguyên nhân: [fixture scheduler](../be/test/integration/vc11.scheduler.test.ts) khai báo DB/JWT nhưng thiếu cả `WEB_ORIGINS` và `CORS_ORIGINS`, trong khi [validation cấu hình](../be/src/config/env.validation.ts) yêu cầu ít nhất một origin. Máy local có tệp môi trường nên che mất thiếu sót; checkout CI không có tệp này. [Log tái hiện](../be/.tmp/vc17-scheduler-ci/baseline-no-env.tap) thoát giống remote; [log chẩn đoán](../be/.tmp/vc17-scheduler-ci/diagnostic-no-env.tap) sau khi cho Nest trả rejection xác nhận đúng lỗi tiếng Việt `Cấu hình không hợp lệ hoặc còn thiếu: CORS_ORIGINS, WEB_ORIGINS`.

Bản sửa chỉ áp fixture: khai báo hai alias origin cùng loopback trước import AppModule để cả tiến trình chính và tiến trình restart có cấu hình đầy đủ; đặt `abortOnError=false` cho hai lần dựng Nest trong test để node:test/execFile ghi nguyên nhân khi khởi tạo thất bại. Giữ logger tắt, không nới validation cấu hình sản phẩm, không tắt assertion hoặc bỏ thu coverage VC11. Comment bổ sung giải thích cấu hình, đầu vào/đầu ra và nhánh lỗi, không có dấu chấm cuối dòng.

Kiểm thực tế sau sửa, từ thư mục làm việc thử không có tệp môi trường và đã gỡ cả hai biến CORS khỏi môi trường tiến trình cha:

- PostgreSQL 16 riêng cổng 55449, DB `vc11_test` mới, đủ 11 migration: [VC11 thường](../be/.tmp/vc17-scheduler-ci/fixed-no-env.tap) **1/1 đạt, 0 fail/skip**, khoảng 15,49 giây
- PostgreSQL 16 riêng cổng 55450, DB mới cùng tên, đủ 11 migration: [VC11 bật NODE_V8_COVERAGE](../be/.tmp/vc17-scheduler-ci/fixed-with-coverage.tap) **1/1 đạt, 0 fail/skip**, khoảng 17,27 giây, gồm tiến trình Nest restart kế thừa coverage như CI
- TypeScript `--noEmit`, ESLint tệp sửa, Gitleaks các dòng mới, `git diff --check` và rà comment đạt

Giữ riêng artifact remote, log tái hiện và hai lượt sau sửa; không ghi đè bằng chứng trước, không reset DB dùng chung hoặc sửa migration. Hai container mới được dừng sau kiểm. Chưa chạy lại toàn bộ VC17 hoặc Actions remote sau bản sửa fixture này; các bộ remote đã đạt được ghi nhận theo run của chúng, không ghép thành một lượt CI hoàn tất. Checklist điều kiện CI tiếp tục chờ lượt remote mới.

## Giới hạn xác nhận tại mốc 19/11

Chưa có quyết định chính sách của thầy; không biến lịch tạm thành chính sách đã nghiệm thu. Actions remote gần nhất `44459025787` còn lỗi fixture VC11; bản sửa đã kiểm hai lượt local nhưng chưa xác nhận lượt remote mới. SMTP thật tại Mailpit không phải bằng chứng gửi Web Push đến thiết bị thật hoặc email tới người thật. ZNS mặc định tắt, không yêu cầu secret/template hay demo gửi thật có phí trong VC17.


## Kiểm lại yêu cầu mới ngày 24/11/2026

Xem [biên bản hoàn thiện](./HOAN_THIEN_2026-11-24.md): lịch hai mốc, Excel sinh, ngưỡng tùy chỉnh, browser hai vai trò 20/20, dependency đã vá, Docker/HTTPS và backup/restore trên project riêng. Giữ kết quả lượt tổng đầu có lỗi PDF.js/Form ID và các lượt kiểm lại đạt. CI mới của `ab8c047` đã xác nhận thành công cả bốn job, 42/42 bước VC17; chưa nghiệm thu môi trường Supabase/hạ tầng bảo vệ. Không sửa kết quả lịch sử ở trên thành kết quả của chính sách mới.

## Chuẩn bị kiểm tải 1.000 đơn vị ngày 28/11/2026

Các thay đổi này chưa phải kết quả nghiệm thu tải 1.000 người. Chạy từng kịch bản trên DB test mới, ghi lại CPU/RAM, vị trí DB, cấu hình pool/cache/concurrency và kết quả trước/sau. Không dùng fixture hoặc secret production.

### Thay đổi và điều kiện triển khai

- Hồ sơ dùng khóa kỳ `FOR SHARE`, vẫn khóa riêng hàng hồ sơ bằng `FOR UPDATE`. Công bố, chỉnh cấu hình, chuyển phase và yêu cầu bổ sung có thể chuyển phase giữ khóa kỳ độc quyền. Kiểm giờ DB và trigger deadline vẫn hoạt động.
- Scheduler đổi phase trong transaction ngắn; reconcile hồ sơ quá hạn theo lô 100. Nếu restart sau khi phase đã đổi, các DRAFT quá hạn vẫn được quét tiếp. History/audit và outbox của mỗi lô commit cùng nhau.
- Migration mới tạo `notification_outbox`. **Chạy migration trước khi khởi động backend mới**: `npm ci`, `npm run db:generate`, `npm run build`, `npm run db:migrate:deploy` trên môi trường đích đã cấu hình đúng DB. Không chạy lại migration đã áp dụng bằng cách sửa nội dung migration cũ.
- Fanout được ghi bền vững cùng nghiệp vụ; worker đọc preference, insert notification/delivery và audit theo lô tối đa 100. Hộp thư cập nhật sau nhịp worker, không bảo đảm có thông báo ngay khi API chuyển phase trả về. Test cần gọi `flushOutbox()` hoặc chờ công việc hoàn tất trước khi kiểm hộp thư.
- Hai worker mặc định concurrency 5, ngân sách nhận việc mới 4 giây mỗi nhịp 5 giây. Việc đang gửi được hoàn tất sau khi ngân sách hết; không claim cả hàng dài rồi để lease hết hạn trước khi gửi.
- Credential chỉ giữ transaction ở bước kiểm/giải mã và ghi kết quả. Version, trạng thái claim và email được kiểm lại trước gửi; reset trong khi I/O đang chạy vẫn hủy claim và vô hiệu mật khẩu cũ. Thư đã được provider chấp nhận có thể đến sau reset; không thể thu hồi I/O bên ngoài bằng transaction PostgreSQL. SMTP/Web Push vẫn có khả năng giao lại sau crash; Resend dùng idempotency key ổn định.
- Runtime dùng `bcrypt` native, cost 12, đọc được hash bcrypt cũ. `bcryptjs` chỉ còn là dependency test. Trên Linux dùng Node 22 phù hợp với image build/runtime; Docker và cấu hình PM2 đặt `UV_THREADPOOL_SIZE=8`.
- GET nghiệp vụ cache danh tính tối đa 3 giây, theo user/version; đường ghi và `auth/me` luôn đọc DB. Mọi HTTP ghi xóa cache của tiến trình khi trả response; replica khác hết hiệu lực theo TTL. Đặt `AUTH_CACHE_TTL_MS=0` nếu cần mọi GET thu hồi quyền ngay. Dashboard cache 5 giây và gộp request cùng key, chỉ chạy sau guard ADMIN.
- FE dừng polling khi tab ẩn, tránh chồng request và giãn nhịp khi lỗi. Hồ sơ UNIT poll mỗi 30 giây, nhận cả summary trong response chi tiết để giảm một API. Route/ExcelJS tiếp tục lazy load; cache assets được cấu hình ở cả Nginx và Vercel. Header thực tế cần kiểm lại sau deploy.

Các biến cấu hình có giá trị mặc định trong [mẫu môi trường](../be/.env.example). `DB_POOL_MAX=20` áp dụng **mỗi tiến trình**; tổng pool của các replica phải phù hợp giới hạn DB. [Cấu hình PM2](../deploy/ecosystem.config.cjs) dành cho VPS nhiều core; chạy `pm2 start deploy/ecosystem.config.cjs` từ root repo sau khi build và cài PM2. Không chạy thêm PM2 trong container backend đang có. Cấu hình không mua/nâng gói Render hoặc triển khai dịch vụ thật; chọn tài nguyên CPU/RAM theo kết quả đo.

### Tạo dữ liệu test riêng

Ví dụ PowerShell, bắt đầu từ thư mục `be`. Các script chỉ nhận `NODE_ENV=test`, DB loopback tên `seminar_load_test` hoặc `seminar_load_test_<hậu_tố>`, và từ chối DB có sẵn dữ liệu. Dùng DB và tên fixture mới cho mỗi kịch bản.

```powershell
docker run -d --name seminar-load-browse -e POSTGRES_PASSWORD=local_load_only -e POSTGRES_DB=seminar_load_test_browse -p 127.0.0.1:55449:5432 postgres:16-alpine
$env:NODE_ENV = 'test'
$env:LOAD_TEST_DATABASE_URL = 'postgresql://postgres:local_load_only@127.0.0.1:55449/seminar_load_test_browse'
$env:DATABASE_URL = $env:LOAD_TEST_DATABASE_URL
$env:JWT_SECRET = 'load-test-only-use-a-separate-random-secret-32-characters'
$env:LOAD_TEST_MODE = 'browse'
$env:LOAD_TEST_USERS = '1000'
$env:LOAD_TEST_CRITERIA = '30'
$env:LOAD_TEST_FIXTURE_PATH = '.tmp/load-test/browse-users.json'
$env:LOAD_TEST_BASE_URL = 'http://127.0.0.1:3001'
npm ci
npm run db:generate
npm run build
npm run db:migrate:deploy
npm run load:seed
```

Fixture chứa 1.000 danh tính UNIT riêng, 20 ADMIN, 30 tiêu chí lá, một hash dùng chung và JWT được ký bằng `JwtService`. Mật khẩu không cần đăng nhập và `mustChangePassword=false`. Fixture có hạn hai giờ, nằm ngoài Git; không đưa file token lên artifact công khai. Để seed cho backend staging từ máy khác, dùng `LOAD_TEST_BASE_URL` đúng origin staging và `LOAD_TEST_ALLOW_REMOTE=true`; DB vẫn qua loopback hoặc SSH tunnel tới DB test riêng. Chuyển fixture sang máy chạy k6 bằng kênh riêng.

Khởi động backend test trong terminal có cùng môi trường/JWT/DB (dùng terminal khác cho k6):

```powershell
$env:PORT = '3001'
$env:WEB_ORIGINS = 'http://localhost:5173'
$env:RATE_LIMIT_ENABLED = 'false'
$env:EMAIL_ENABLED = 'false'
$env:WEB_PUSH_ENABLED = 'false'
$env:ZALO_ZNS_ENABLED = 'false'
$env:STORAGE_ENABLED = 'false'
$env:REPORT_EXPORT_PROVIDER = 'local'
$env:METRICS_ENABLED = 'true'
$env:METRICS_TOKEN = 'load-test-metrics-only-separate-token-32-characters'
npm start
```

Production vẫn bắt buộc rate limit. Không tắt rate limit trên domain dùng chung. `BACKGROUND_JOBS_ENABLED=false` chỉ dùng khi muốn tách riêng bài đo job khỏi worker tự chạy.

Kiểm hồi quy khóa/outbox/reset bằng `npm run test:performance` với `PERF_TEST_DATABASE_URL` trỏ tới DB loopback **mới, chưa seed**, tên `seminar_load_test` đã migrate. Bộ kiểm này ghi fixture riêng và từ chối DB có sẵn user; không chạy lại trên DB đang dùng cho k6.

### Năm kịch bản độc lập

1. **Duyệt/polling 30 phút**, fixture `LOAD_TEST_MODE=browse`:

```powershell
$env:K6_WEB_DASHBOARD = 'true'
k6 run -e SCENARIO=browse -e TARGET_VUS=1000 -e HOLD_DURATION=30m -e FIXTURE_PATH=../../.tmp/load-test/browse-users.json --summary-export .tmp/load-test/browse-result.json test/load/scenarios.k6.js
```

2. **Lưu 30 ô và nộp trong 5 phút**, DB mới, fixture `LOAD_TEST_MODE=deadline`:

```powershell
k6 run -e SCENARIO=deadline -e TARGET_VUS=1000 -e SPREAD_SECONDS=240 -e FIXTURE_PATH=../../.tmp/load-test/deadline-users.json --summary-export .tmp/load-test/deadline-result.json test/load/scenarios.k6.js
```

Kịch bản kiểm từng `results[].ok`, chỉ nộp khi mọi ô được lưu. Cửa sổ hồ sơ fixture vẫn mở hai giờ để tách tải ghi khỏi bài đo chuyển phase; việc 1.000 đơn vị lưu/nộp được trải trong 5 phút. Đặt `LOAD_TEST_FIXTURE_PATH` đúng file deadline rồi chạy `npm run load:verify` để kiểm ghi đúng đơn vị và trạng thái đã nộp.

3. **20 admin thẩm định song song với 1.000 UNIT đọc**, DB mới, fixture `LOAD_TEST_MODE=review`. Seed điền điểm tự chấm và đưa hồ sơ vào `PENDING_REVIEW`/`FIRST_REVIEW`:

```powershell
k6 run -e SCENARIO=review -e TARGET_VUS=1000 -e ADMIN_VUS=20 -e HOLD_DURATION=30m -e FIXTURE_PATH=../../.tmp/load-test/review-users.json --summary-export .tmp/load-test/review-result.json test/load/scenarios.k6.js
```

4. **Chuyển phase và fanout**, DB mới, fixture `LOAD_TEST_MODE=phase`. Dừng backend test hoặc tắt background job khi chạy phép đo trực tiếp này:

```powershell
$env:LOAD_TEST_FIXTURE_PATH = '.tmp/load-test/phase-users.json'
npm run load:jobs -- phase
```

Script đẩy deadline test về quá khứ, gọi scheduler thật, kiểm tất cả hồ sơ thành `PENDING_REVIEW`, rồi drain outbox. Kết quả cạnh file fixture ghi riêng `processingMs`, `fanoutMs`, số notification và độ sâu delivery. Với 20 ADMIN, 1.000 thông báo auto-lock cho từng admin tạo thêm 20.000 notification ngoài thông báo đổi phase; tính cả fanout này khi đánh giá DB và queue.

5. **Cấp credential**, DB mới, fixture `LOAD_TEST_MODE=credentials`:

```powershell
$env:LOAD_TEST_FIXTURE_PATH = '.tmp/load-test/credentials-users.json'
$env:LOAD_TEST_CONCURRENCY = '5'
$env:LOAD_TEST_PROVIDER_MS = '50'
npm run load:jobs -- credentials
```

Script dùng mã hóa/claim/version/ghi kết quả thật và hai provider giả có độ trễ hữu hạn; **không gửi email hoặc Push ra ngoài**. Kết quả kiểm đủ 2.000 delivery và peak concurrency. Đây là phép đo worker/DB, chưa xác nhận hạn mức hoặc độ trễ của provider thật. Muốn đo email thật, dùng tập địa chỉ đã kiểm soát và tốc độ phù hợp tài khoản provider; không dùng 1.000 địa chỉ giả của fixture.

Bài đo tương tác 80% đọc/20% ghi cũ vẫn ở [workload.k6.js](../be/test/load/workload.k6.js), hỗ trợ đọc file token và ngưỡng riêng cho đọc/ghi. Có thể chạy thêm bài này với thời gian nghỉ 1–3 giây để tạo tải thao tác cao hơn polling 30 giây. Các file k6 cần k6 được cài trên máy phát tải; `node --check` chỉ kiểm cú pháp, không thay thế chạy k6.

### Quan sát và gửi email HTTPS

`GET /metrics` chỉ mở khi `METRICS_ENABLED=true`, yêu cầu `Authorization: Bearer <METRICS_TOKEN>`. Prometheus có thể scrape với `authorization.credentials_file` trỏ tới file token private. Các metric gồm `seminar_http_duration_seconds` theo route template, `seminar_db_query_duration_seconds`, `seminar_db_connections{state="waiting"}` và `seminar_event_loop_lag_p99_seconds` trên cửa sổ 10 giây; không đưa URL/SQL/credential vào label. Dùng `histogram_quantile(0.95, sum by (le, route) (rate(seminar_http_duration_seconds_bucket[5m])))` để xem p95 API.

Chạy [diagnostics.sql](../be/test/load/diagnostics.sql) trong lúc tải để đọc lock, transaction đang chờ và `pg_stat_statements` (extension cần được bật trước). Mục tiêu gợi ý: lỗi dưới 1%, p95 đọc dưới 1 giây, p95 ghi dưới 2 giây, event loop lag p99 dưới 100 ms. Chốt ngưỡng với người nghiệm thu và giữ nguyên giữa hai lượt so sánh. Chạy Lighthouse/trình duyệt thật trong lúc k6 đang tải để kiểm LCP/INP/CLS.

Để chuyển email sang [Resend API HTTPS](https://resend.com/docs/api-reference/emails/send-email), đặt `EMAIL_ENABLED=true`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` thuộc domain đã xác minh và `CREDENTIALS_ENCRYPTION_KEY`. Request có timeout, idempotency key, chuẩn hóa 429 thành retry và không lưu phản hồi chứa bí mật. SMTP/Apps Script vẫn được hỗ trợ. Việc thêm provider không tạo tài khoản, mua gói hoặc gửi thư thật.

Kiểm header sau triển khai bằng `curl -I https://<staging>/assets/<file-co-hash>.js`: cần `public`, `max-age=31536000`, `immutable`; HTML không cache dài. [Compose](../deploy/compose.yml) hỗ trợ truyền pool/cache/concurrency/metrics và cấu hình Resend qua môi trường.
