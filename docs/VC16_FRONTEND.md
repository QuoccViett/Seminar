# VC16 — Hoàn thiện giao diện và tích hợp frontend

**Kết luận 19/11/2026:** hoàn thành DoD VC16, full FE 43/43 và Chrome 18/18 nhóm kiểm với Nest/PostgreSQL/storage thật, không mock backend

## Phạm vi và hiện trạng

Baseline `main` tại `bb49bd9`, working tree sạch trước khi sửa
Đã đối chiếu kế hoạch VC16, cấu trúc Auth controller/service/module/DTO/test, API contract, schema Prisma, danh sách 11 migration cùng SQL liên quan và các trang/service frontend
Giữ NestJS, Prisma, PostgreSQL, ESM, JavaScript/JSX hiện tại; không sửa schema, migration đã áp dụng hoặc generated client

## Thay đổi

| Nhóm | Nội dung |
|---|---|
| Điều hướng | Layout riêng UNIT, breadcrumb ADMIN, menu bàn phím, 403/404, tải mã theo từng trang, fallback tiếng Việt và error boundary |
| Phiên | Xác nhận `/auth/me` trước khi mở nghiệp vụ, không cấp quyền bằng user cache khi lỗi mạng; đồng bộ user sau refresh; nhận `PASSWORD_CHANGE_REQUIRED`; nhắc phiên sắp hết hạn; giữ lời nhắc hết phiên qua điều hướng guard; refresh cũ không xóa phiên mới |
| API và lỗi | Giữ pagination khi giải envelope; lọc lỗi trường; không phản chiếu Axios/SQL/provider; gắn field nested vào form và giữ chi tiết trong toast; Web Push dùng cùng adapter, lời mời public không gắn hoặc xóa phiên đang mở |
| Tiến độ | Nháp tự chấm/thẩm định/phản hồi trong RAM theo phiên và UUID hồ sơ; giữ khi chuyển trang; xóa khi mất phiên/đổi mật khẩu; cảnh báo đóng trang có nháp |
| Kỳ | URL ưu tiên, lưu lựa chọn trong phiên giữa dashboard/hồ sơ/báo cáo; direct URL hồ sơ được lưu lại để reload; đọc đủ trang lựa chọn kỳ |
| Quyền và thời gian | Quyền từ backend; refetch khi focus/quay lại tab/mốc mở/hết hạn; countdown dùng serverTime và performance.now, không lặp HTTP khi snapshot đã quá hạn; bulk save không bỏ qua quyền từng lá |
| Tương tác | Giữ nháp khi lưu lỗi, xác nhận lệnh thẩm định quan trọng; bảng cuộn và form responsive; Enter trong RangePicker không gửi form trước khi lịch được xác nhận; React hiển thị văn bản thuần; link minh chứng chỉ HTTP/HTTPS |
| Demo và mock | MSW chỉ bật khi chủ động trong dev/test; mock dùng SELF_EVAL và chính sách mật khẩu mới; bản kiểm chứng trỏ Nest/PostgreSQL thật |

Giữ Import Excel kéo thả, mật khẩu ban đầu cấu hình demo 123456, bắt đổi mật khẩu ở backend và mật khẩu mới tối thiểu 8 ký tự cùng các chặn hiện hành
Giữ lịch tự chấm mọi ngày/giờ và lịch bổ sung tạm mục 1.4/5.4, thứ Sáu hết trong ngày, chờ hỏi thầy; không tính hạn từ supplementHours
Giữ kiến trúc Web Push/Email/Zalo ZNS; các provider ngoài đều tắt trong fixture VC16, không gửi ra người thật
Biên bản dành cho UNIT không được mở rộng quyền vì contract hiện chỉ cho ADMIN xuất/tải

## Môi trường kiểm chứng

PostgreSQL 16-alpine riêng `seminar-vc16-test-20261118`, loopback 55446, database `vc16_test`
Đã áp dụng đủ 11 migration lên DB mới, không reset hoặc migrate DB dùng chung
Nest fixture loopback 3186, frontend loopback 5186, `VITE_API_MOCKING=disabled`
Fixture thêm UUID/năm riêng, chỉ tài khoản thử, không dùng mock thay API hoặc storage local thật
Credential và ảnh/log thử nằm trong thư mục `.tmp` đã bỏ qua Git, không ghi bí mật vào biên bản

## Kết quả thực chạy

| Kiểm tra | Kết quả hiện có |
|---|---|
| Backend build | Đạt |
| Backend lint sau sửa harness | Đạt |
| Backend typecheck `tsc --noEmit` | Đạt, gồm fixture TypeScript mới |
| Frontend lint | Đạt, một cảnh báo ở service worker sinh tự động |
| Frontend production build | Đạt trên nguồn cuối trong 1 phút 33 giây, có chunk chung 852,30 kB và cảnh báo vượt 500 kB |
| Production MSW | Không tìm thấy mã khởi động MSW trong các chunk build |
| Full frontend test | Đạt 43/43 trong 16 tệp, 297,73 giây, gồm countdown, thông báo hết phiên và refresh cũ không xóa phiên mới |
| Kiểm thử trọng tâm trước full suite | 17/17 đạt trong 5 tệp, 131,60 giây |
| Prisma validate | Đạt |
| Migrate deploy DB VC16 | Đạt, 11/11 migration |
| HTTP đăng nhập và CORS | 200 và preflight 204, origin đúng 5186 |
| HTTP lịch bổ sung tạm | 5/5 ngày thứ Hai–thứ Sáu đạt, gồm thứ Sáu 23:59; cuối tuần bị từ chối |
| Chrome hai vai trò | Đạt 18/18 nhóm kiểm trên build cuối, `mockBackend: false`, exit 0 |
| Rà comment | Parser Babel/PostCSS kiểm 624 dòng comment trong 49 tệp mã, gồm comment nội tuyến và JSX, không dấu chấm cuối dòng |
| Git diff check | Đạt, chỉ có nhắc LF sẽ được Git chuẩn hóa thành CRLF ở một tệp |

Các lượt trước từng timeout ở UnitRecords khi máy thiếu RAM; giữ toàn bộ assertion, cô lập interval nền trong unit test và thêm cleanup listener, chạy một worker VM với ngữ cảnh JSDOM riêng từng tệp
Một lượt chạy đủ 39 ca đạt nhưng App không collect do entry CommonJS của thư viện icon require mã ESM; runner dùng entry es thật của thư viện và Vite xử lý phụ thuộc, không mock icon hoặc sửa node_modules
Sau sửa runner full 40/40 đạt; rà tiếp phát hiện vòng refetch countdown sau hạn và bổ sung kiểm thử, lượt tiếp theo 41/41 đạt
Chrome tiếp tục phát hiện Enter trong RangePicker gửi form sớm với lịch null và guard có thể làm mất thông báo hết phiên; đã sửa picker và giữ thông báo trong Auth context, bổ sung ca hồi quy dùng provider/guard/login thật
Ca refresh cũ hoàn tất sau phiên đăng nhập mới phát hiện lỗi xóa nhầm phiên; adapter gom promise theo refresh token và chỉ xóa đúng phiên còn trùng mốc bắt đầu
Các lượt build bị dừng khi chạy đồng thời do thiếu RAM không được dùng làm bằng chứng; lượt production cuối chạy tuần tự đã thành công
Các lượt Chrome trước từng dừng ở timeout mạng, selector icon, điểm nhận drop, hiệu ứng đóng picker và hai nút Đóng trùng tên; bài kiểm được sửa để dùng đúng DOM/ngữ nghĩa và vẫn chuyển tiếp request tới Nest thật
Lint backend từng bắt script debug tạm trong thư mục bỏ qua Git; đã dọn đúng tệp do lượt này tạo và chạy lại full lint/typecheck thành công
Nguồn cuối đã chạy tuần tự: full FE 43/43, lint/build, rồi Chrome 18/18; không dùng các lượt đang chạy trên module cache cũ làm bằng chứng chốt

## Bằng chứng Chrome cuối

Kết quả máy đọc tại `be/.tmp/vc16-artifacts/browser-results.json`, log tại `be/.tmp/vc16-browser-final.log`, ảnh mobile đã xem lại trực quan
Các tệp này được bỏ qua Git vì chứa dữ liệu fixture, không đưa credential/token/URL ký vào biên bản

1. ADMIN chọn kỳ theo URL, chuyển sang báo cáo và reload vẫn đúng kỳ, tạo/tải XLSX thật và đọc lại sheet Tổng hợp
2. GET 200 thật của các trang đơn vị, tài khoản, cấu hình, hộp thư và audit
3. Tải danh sách mất mạng có cảnh báo cố định, thử lại nhận đúng tài khoản từ backend
4. Kéo thả bytes XLSX qua Dragger, preview rồi confirm tạo UNIT thật, cờ bắt đổi mật khẩu được lưu trong DB
5. Sửa tài khoản, reset mật khẩu ban đầu 123456, khóa/mở và đọc trạng thái kênh chưa gửi, đối chiếu DB
6. Sửa đơn vị qua form và đối chiếu tên đã lưu trong DB
7. Enter trong picker không tạo kỳ sớm, bấm lưu tạo kỳ/ngưỡng, thêm tiêu chí và công bố; DB có đủ lịch hợp lệ, bốn ngưỡng, một lá và phase SELF_EVAL
8. Thẩm định giữ nháp qua menu, lưu rồi reload direct URL đúng hồ sơ và diễn giải từ DB
9. UNIT đăng nhập mật khẩu ban đầu, gọi nghiệp vụ bị BE chặn 403 PASSWORD_CHANGE_REQUIRED, đổi mật khẩu đạt chính sách mới và vào layout UNIT
10. Trước giờ mở không có nội dung tiêu chí; đổi Date.now không lộ dữ liệu; chỉ sau điều kiện mở phía server và refetch mới xuất hiện
11. Nháp UNIT còn nguyên qua menu và lỗi mất mạng, trì hoãn request rồi chuyển tiếp vẫn lưu vào backend thật
12. Upload PDF có bytes hợp lệ vào kho local thật, xác nhận gắn minh chứng, mở preview bằng Enter và đóng bằng Escape
13. Phản hồi HTML bị BE từ chối và giữ nháp để sửa, gửi văn bản thuần thành công và đọc lại lịch sử
14. Nộp hồ sơ tự chấm qua popup, DB chuyển PENDING_REVIEW
15. Chấp nhận ô/hoàn tất lượt đầu có xác nhận, preview lịch thứ Sáu 23:00 kết thúc trước 00:00 thứ Bảy, yêu cầu bổ sung; UNIT chỉ sửa lá được chọn, nộp lại; ADMIN thẩm định, chuyển FINAL_REVIEW và chốt 84 điểm, UNIT thấy đúng kết quả chính thức
16. Hai vai trò ở 390 px không tràn viewport, selector còn trong màn hình; UNIT không có menu ADMIN, direct URL sai vai trò hiện 403 và URL lạ hiện 404
17. Chặn request lưu rồi đẩy deadline DB qua hạn, sau đó chuyển tiếp; chờ phản hồi thật có mã SELF_EVALUATION_LOCKED, UI giữ nháp 81,00 và DB vẫn 80
18. ADMIN khóa đúng tài khoản thử, access/refresh bị từ chối; UNIT mất phiên và thấy lời nhắc tiếng Việt trên trang đăng nhập

Mốc chờ mở/hạn chỉ được rút ngắn trong đúng DB fixture để không phải chờ ngày thực; mọi baseline, lệnh ghi/nộp/bổ sung/chốt, quyền và audit do backend thật xử lý

## Cách chạy kiểm lại

```powershell
# Chỉ dùng URL database thử riêng vc16_test trên loopback
if (!$env:VC16_TEST_DATABASE_URL) { throw 'Cần đặt URL database VC16 riêng trước khi chạy' }
$vc16DatabaseUri=[Uri]$env:VC16_TEST_DATABASE_URL
if ($vc16DatabaseUri.Host -ne '127.0.0.1' -or $vc16DatabaseUri.AbsolutePath -ne '/vc16_test') { throw 'Chỉ được dùng database vc16_test trên loopback' }
$env:DATABASE_URL=$env:VC16_TEST_DATABASE_URL
node node_modules/prisma/build/index.js migrate deploy
npm run build
$env:VC16_FE_ORIGIN='http://127.0.0.1:5186'
$env:VC12_HTTP_PORT='3186'
node --import tsx test/integration/vc16.browser-fixture.ts
```

Trong thư mục frontend, chạy tuần tự để tránh thiếu RAM rồi giữ preview ở terminal riêng

```powershell
$env:NODE_OPTIONS='--max-old-space-size=512'
$env:VITE_API_URL='http://127.0.0.1:3186'
$env:VITE_API_MOCKING='disabled'
npm run lint
npm test
npm run build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5186 --strictPort
```

Ở terminal backend khác, giữ cùng VC16_TEST_DATABASE_URL và VC16_FE_ORIGIN đã xác nhận ở trên

```powershell
# Dùng module Playwright và Chrome đã cài sẵn trên máy
$env:VC16_PLAYWRIGHT_MODULE='E:/Seminar/Backups/vc10-browser-tools/node_modules/playwright-core/index.mjs'
node --import tsx test/browser/vc16.frontend.mjs
```

Mỗi lượt Chrome đầy đủ cần khởi động lại fixture để cấp UUID/credential mới vì bài kiểm có nộp, chốt và khóa user; fixture thêm dữ liệu, không reset DB
Không in nội dung tệp credential `.tmp/vc16-browser-state.json` vào log hoặc đưa vào Git

## Giới hạn và điểm còn chờ

Không còn điều kiện DoD VC16 chưa có bằng chứng trong phạm vi frontend đã chốt
Nháp nằm trong RAM để giữ khi chuyển màn; đóng/reload có cảnh báo mất nháp, dữ liệu đã lưu được đọc lại từ backend
Giữ cảnh báo bundle trên 500 kB, các API cũ của Ant Design và JSDOM thiếu đo pseudo-element; các kiểm tra vẫn exit 0, không giấu cảnh báo hoặc sửa service worker sinh tự động chỉ để hết lint
Không xác nhận CI remote, deploy, bucket Supabase VC10 hoặc gửi provider thật trong lượt VC16
Phần gửi thật vẫn cần cấu hình SMTP/VAPID/OA/template và người nhận/môi trường được chỉ định, không coi trạng thái xếp hàng là đã giao thông tin
ZNS tắt theo phạm vi đã chốt, không coi thiếu OA/template trả phí là lỗi demo
Lịch bổ sung và mẫu hành chính vẫn chờ xác nhận của giảng viên như kế hoạch hiện hành

## Tệp thay đổi

51 tệp trong repository và 1 tệp kế hoạch ngoài repository được sửa hoặc thêm, không có schema/migration/generated file trong danh sách

- [be/eslint.config.js](../be/eslint.config.js)
- [be/test/browser/vc16.frontend.mjs](../be/test/browser/vc16.frontend.mjs)
- [be/test/integration/vc12-support.ts](../be/test/integration/vc12-support.ts)
- [be/test/integration/vc16.browser-fixture.ts](../be/test/integration/vc16.browser-fixture.ts)
- [docs/API_CONTRACT.md](../docs/API_CONTRACT.md)
- [docs/VC16_FRONTEND.md](../docs/VC16_FRONTEND.md)
- [fe/src/App.jsx](../fe/src/App.jsx)
- [fe/src/App.test.jsx](../fe/src/App.test.jsx)
- [fe/src/components/common/ErrorBoundary.jsx](../fe/src/components/common/ErrorBoundary.jsx)
- [fe/src/components/common/SessionNotice.jsx](../fe/src/components/common/SessionNotice.jsx)
- [fe/src/components/records/EvidencePanel.jsx](../fe/src/components/records/EvidencePanel.jsx)
- [fe/src/components/records/FeedbackPanel.jsx](../fe/src/components/records/FeedbackPanel.jsx)
- [fe/src/components/records/FeedbackPanel.test.jsx](../fe/src/components/records/FeedbackPanel.test.jsx)
- [fe/src/components/records/ReviewCard.jsx](../fe/src/components/records/ReviewCard.jsx)
- [fe/src/components/records/SelfEvaluationCard.jsx](../fe/src/components/records/SelfEvaluationCard.jsx)
- [fe/src/contexts/AuthContext.jsx](../fe/src/contexts/AuthContext.jsx)
- [fe/src/contexts/AuthContext.test.jsx](../fe/src/contexts/AuthContext.test.jsx)
- [fe/src/contexts/WorkspaceContext.jsx](../fe/src/contexts/WorkspaceContext.jsx)
- [fe/src/contexts/WorkspaceContext.test.jsx](../fe/src/contexts/WorkspaceContext.test.jsx)
- [fe/src/index.css](../fe/src/index.css)
- [fe/src/layouts/AdminLayout.jsx](../fe/src/layouts/AdminLayout.jsx)
- [fe/src/layouts/AdminLayout.module.css](../fe/src/layouts/AdminLayout.module.css)
- [fe/src/layouts/UnitLayout.jsx](../fe/src/layouts/UnitLayout.jsx)
- [fe/src/mocks/handlers.js](../fe/src/mocks/handlers.js)
- [fe/src/mocks/handlers.test.js](../fe/src/mocks/handlers.test.js)
- [fe/src/pages/StatusPage.jsx](../fe/src/pages/StatusPage.jsx)
- [fe/src/pages/admin/AdminConfig.jsx](../fe/src/pages/admin/AdminConfig.jsx)
- [fe/src/pages/admin/AdminDashboard.jsx](../fe/src/pages/admin/AdminDashboard.jsx)
- [fe/src/pages/admin/AdminRecords.jsx](../fe/src/pages/admin/AdminRecords.jsx)
- [fe/src/pages/admin/AdminReports.jsx](../fe/src/pages/admin/AdminReports.jsx)
- [fe/src/pages/admin/AdminUnits.jsx](../fe/src/pages/admin/AdminUnits.jsx)
- [fe/src/pages/admin/AdminUsers.jsx](../fe/src/pages/admin/AdminUsers.jsx)
- [fe/src/pages/auth/ChangePasswordPage.jsx](../fe/src/pages/auth/ChangePasswordPage.jsx)
- [fe/src/pages/auth/ChangePasswordPage.module.css](../fe/src/pages/auth/ChangePasswordPage.module.css)
- [fe/src/pages/auth/LoginPage.jsx](../fe/src/pages/auth/LoginPage.jsx)
- [fe/src/pages/auth/LoginPage.module.css](../fe/src/pages/auth/LoginPage.module.css)
- [fe/src/pages/unit/UnitRecords.jsx](../fe/src/pages/unit/UnitRecords.jsx)
- [fe/src/pages/unit/UnitRecords.test.jsx](../fe/src/pages/unit/UnitRecords.test.jsx)
- [fe/src/routes/guards.jsx](../fe/src/routes/guards.jsx)
- [fe/src/routes/guards.test.jsx](../fe/src/routes/guards.test.jsx)
- [fe/src/routes/index.jsx](../fe/src/routes/index.jsx)
- [fe/src/services/apiClient.js](../fe/src/services/apiClient.js)
- [fe/src/services/apiClient.test.js](../fe/src/services/apiClient.test.js)
- [fe/src/services/evidenceService.js](../fe/src/services/evidenceService.js)
- [fe/src/services/formErrors.js](../fe/src/services/formErrors.js)
- [fe/src/services/pagination.js](../fe/src/services/pagination.js)
- [fe/src/services/periodSelection.js](../fe/src/services/periodSelection.js)
- [fe/src/services/session.js](../fe/src/services/session.js)
- [fe/src/services/webPush.js](../fe/src/services/webPush.js)
- [fe/src/test/setup.js](../fe/src/test/setup.js)
- [fe/vite.config.js](../fe/vite.config.js)

Ngoài repository: [Kế hoạch toàn bộ đồ án](../../../TaiLieu/KE_HOACH_VIBE_CODING_TOAN_BO_DO_AN.md), chỉ phần checklist/bằng chứng và dòng tiến độ VC16
Bản sao trước khi sửa kế hoạch: [Bản sao VC16](../../../Backups/KE_HOACH_truoc_VC16_20261118.md)
