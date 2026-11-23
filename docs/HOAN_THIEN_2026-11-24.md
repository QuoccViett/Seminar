# Kết quả hoàn thiện ngày 24/11/2026

Source bắt đầu từ nhánh `fix/admin-unit-ui`, commit `32b6a6f`, Git sạch. Đã triển khai và kiểm chức năng mới A/B/C, hardening, Docker/HTTPS, seed, tài liệu, slide và phục hồi trên môi trường local riêng. Các mục cần Supabase thật, hạ tầng bảo vệ, thiết bị hoặc người xác nhận được giữ mở; không kết luận toàn đồ án đạt 100% khi chưa có các bằng chứng đó.

## Checklist theo yêu cầu

| Mục | Kết quả đã kiểm | Trạng thái còn lại |
|---|---|---|
| 1. Credential lịch sử | Đối chiếu 35 tài khoản bằng bcrypt trên DB local đang cấu hình: cả 35 mật khẩu lịch sử đều đã đổi; không ghi secret vào báo cáo, không viết lại Git | Chủ các môi trường khác nếu có cần kiểm riêng; không thể suy ra từ DB local |
| 2. Dependency | BE và FE đều 0 cảnh báo khi audit toàn bộ dependency, gồm dev; SMTP Mailpit/import/report/auth/coverage đã hồi quy | Chạy lại audit khi làm release mới vì advisory có thể thay đổi |
| 3. CI | Sửa SC2034, Actionlint/ShellCheck đạt. Baseline `32b6a6ff92da66b7669f8be364cc41d194cf3fa0` có [Actions run thành công 45136510688](https://github.com/giahan358/Seminar/actions/runs/45136510688) | CI remote của commit chứa thay đổi mới chưa xác nhận |
| 4. Lịch bổ sung | BE/FE nhận đủ hai mốc, mọi ngày giờ; snapshot UTC, một vòng, retry so cả deadline, nhắc trong cửa sổ, giữ policy/trigger/seed/report | Đã đạt local HTTP/PG/browser và HTTPS demo; rollout môi trường đích cần kiểm kê yêu cầu đang mở |
| 5. Sinh Excel | Form số lượng/số bắt đầu/chữ số/tiền tố/mẫu tên/domain/loại đơn vị; 1/34/100 dòng chuỗi, tải/sửa/preview/confirm thật, retry không trùng | Đã đạt local, giữ 100 dòng và 5 MiB |
| 6. Ngưỡng | Bốn rating, mặc định 85/65/50/0; validator chung lưu/publish, cận hợp lệ, khóa sau công bố; bộ 90/70/45/0 khớp summary/SQL/chốt/dashboard/XLSX/PDF/DOCX | Đã đạt local và demo HTTPS |
| 7. Màu UI | Palette chung, nền phân vùng, nhãn trạng thái và focus; các cặp màu chữ chính đạt tương phản 6,7–16,3:1; browser desktop/mobile không tràn ngang | Tiến Phát/Trường Huy cần xác nhận phối hợp và palette; chưa có xác nhận trực tiếp |
| 8. Tài liệu | Sửa route transition-phase/first-review-complete, cập nhật contract/Swagger/PTCSDL/hướng dẫn/README | Mẫu hành chính và người ký thật giữ phần xác nhận của nhóm |
| 9. Kiểm thử/DoD | BE 218/218, FE 55/55, E2E 2/2, browser hai vai trò 20/20; ba TZ, HTTP/PG/race/upgrade/seed, đối chiếu VC01/02 local ở bảng dưới | VC17 cấp release cần CI mới và môi trường đích |
| 10. Supabase thật | Provider private có guard; có công cụ upload/download/hash/cleanup riêng | Chưa có project/bucket được chỉ định; cấu hình local là placeholder nên chưa chạy thật |
| 11. VC18 | Rate limit, no-store, Swagger production 404, trust proxy, app role tối thiểu, BE/FE/proxy, HTTPS local, backup/restore và smoke sau restore đã đạt | Domain public/CA thiết bị/NTP máy chủ đích, bucket backup và Email/Push thật chưa được chỉ định |
| 12. VC19/20 | Seed base/demo riêng; 34 đơn vị, sáu trạng thái/bốn rating, minh chứng tự tạo; hướng dẫn cài/vận hành và slide HTML/PDF 12 trang đã có | Hai lần diễn tập trên URL/hạ tầng bảo vệ và thiết bị nhận thật chưa thực hiện |

## Kiểm thử và các lượt sửa lỗi

| Nhóm | Kết quả |
|---|---|
| BE unit | 218/218, 0 fail/skip; [runner](../be/scripts/run-tests.mjs) |
| FE | Full 55/55; kiểm lại generator/App 13/13 sau đổi form/theme; lint 0 lỗi, còn một warning từ MSW sinh tự động |
| Lịch/policy | 8/8 trên mỗi TZ UTC, Asia/Ho_Chi_Minh, America/New_York; helper kiểm đủ bảy ngày và khoảng 1 ms/45 phút/10 ngày |
| HTTP/PG | VC03–VC14, scheduler/recovery, seed, upgrade12/13/17 và system đều có lượt đạt; VC15 đọc bytes sau nâng PDF.js đạt 9/9; ngưỡng tùy chỉnh và Excel sinh có lượt riêng đạt |
| Browser mới | 20 nhóm kiểm, backend/storage/PostgreSQL thật, không MSW; gồm form Excel, cấu hình/publish, bắt đổi mật khẩu, biên server, PDF, feedback, bổ sung cuối tuần 45 phút và chốt |
| Entrypoint thật | E2E 2/2; test/production đều qua health/rate limit/no-store/CORS, Swagger test 200 và production 404 |
| Docker/HTTPS | BE/FE/PostgreSQL/Caddy khỏe; migrate/permissions hoàn tất trước runtime; app role không superuser/createdb/createrole, không UPDATE audit hay DELETE history |
| Smoke triển khai | HTTPS loopback, hai vai trò đổi mật khẩu lần đầu, chấm/upload/confirm/download khớp bytes, khóa hạn, một vòng bổ sung/retry, chốt 75/GOOD, dashboard và tải ba báo cáo |
| Backup/restore | Project mới `seminar-restore-completion`; checksum **26 bảng và 301 tệp** khớp trước khởi động; sau restore hai vai trò login/me thành công, kết quả 75/GOOD và minh chứng/XLSX/PDF/DOCX giữ đúng hash |
| Hiển thị triển khai | Màn ADMIN/UNIT đã tải dữ liệu rồi chụp desktop/mobile 390 px; không tràn ngang. Chứng chỉ localhost là CA nội bộ, Playwright bỏ kiểm CA cho lượt local |
| Bảo mật/kiểm tĩnh | Audit toàn bộ BE/FE 0; Actionlint/ShellCheck và quét secret phần nội dung mới đạt; typecheck/lint/build/schema phù hợp đã chạy |

Lượt tổng đầu được giữ nguyên với hai phần lỗi: bộ đọc PDF.js 6 đổi vòng đời `destroy`, và browser phát hiện ID trường trùng giữa hai Form. Đã sửa bằng `loadingTask.destroy()` và Form name riêng, rồi kiểm lại VC15 trên DB mới (9/9), ngưỡng/file, browser trên DB mới (20/20). Không đổi manifest lượt lỗi thành đạt. Coverage của lượt tổng đầu là 91,38% dòng; đây không thay cho coverage/CI của commit release cuối.

Các log/JSON/ảnh chi tiết nằm trong `be/.tmp` local bị Git bỏ qua. Báo cáo này lưu kết luận và giới hạn để vẫn đọc được khi dọn tệp tạm; CI phải xuất artifact riêng từ đúng commit. Không có thay đổi migration đã áp dụng hoặc backfill thời hạn đã thông báo.

## Đối chiếu DoD VC01 và VC02

| Điều kiện | Bằng chứng hiện tại | Kết luận |
|---|---|---|
| Payload lỗi bốn field, tiếng Việt, nested/array/field lạ/JSON/404/multipart/413 | Unit foundation/http-vc01, integration quyền/DTO và E2E main thật; filter không phản chiếu lỗi provider/SQL | Đạt phạm vi local |
| Log metadata, không bí mật; audit che dữ liệu lồng nhau | Unit middleware/audit trong 218/218 và log HTTPS chỉ requestId/method/status/duration | Đạt phạm vi local |
| Config theo cờ, UTC/Decimal/BigInt, UNIT thiếu/sai đơn vị bị chặn trước DB | Unit/config, VC03 HTTP/PG, policy ba TZ; production tắt Swagger và demo tools | Đạt phạm vi local |
| Login/refresh rotation/reuse/concurrency/logout/me, version và đổi mật khẩu | Auth/guard unit, VC03/auth/system và browser bắt đổi mật khẩu, khóa tài khoản mất phiên | Đạt phạm vi local |
| Min 8, Unicode/72 byte/username/hash cũ/phổ biến; FE nhận lỗi và giữ phiên đúng | Unit policy, system HTTP/PG và browser 7 ký tự bị chặn/8 ký tự được nhận | Đạt phạm vi local |
| Luồng frontend với backend thật, import/reset dùng mật khẩu cấu hình | Browser 20/20 và HTTPS hai vai trò/đổi mật khẩu/upload/chốt | Đạt phạm vi local |
| Release/rollout/provider thật | CI mới, bucket/domain/thiết bị/hạ tầng bảo vệ | Giữ ở VC10/17/18/20, không lẫn với DoD local |

## Vận hành và bàn giao

- [README cài đặt, seed, test, Docker và phục hồi](../README.md)
- [Contract](./API_CONTRACT.md), [API](<./danh sách api.md>), [OpenAPI](../be/docs/openapi.json), [schema](../be/prisma/schema.prisma)
- [Credential và dependency](./SECURITY_REMEDIATION.md), [kịch bản nghiệm thu](./DEMO_NGHIEM_THU.md)
- [Slide HTML](./bao-ve.html), [PDF 12 trang](./BAO_VE_DO_AN.pdf)
- [Backup/restore](../deploy/backup-restore.mjs), [Compose](../deploy/compose.yml), [mẫu env](../deploy/.env.example)
- [Kiểm Supabase thật](../be/scripts/verify-supabase.mjs), [smoke deployment](../be/scripts/verify-deployment.mjs), [đối chiếu restore](../be/scripts/verify-restored.mjs)

Secret, mật khẩu demo sau đổi, dump DB và backup tệp không nằm trong Git. Không bật gửi Email/Push cho người thật hoặc ZNS. Để đóng toàn bộ checklist cần chủ môi trường chỉ định bucket/project, domain/server, thiết bị nhận và người xác nhận UI; sau đó chạy đúng ma trận/kịch bản tại môi trường đó, không dùng kết quả local thay thế.
