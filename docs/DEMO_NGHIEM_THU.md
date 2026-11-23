# Kịch bản demo và bàn giao nghiệm thu

Kịch bản dành cho người vận hành, người trình bày ADMIN và người trình bày UNIT. Dùng cùng bản release, URL và hạ tầng sẽ bảo vệ. Mỗi lần diễn tập ghi commit, thời gian, thiết bị, người thao tác, kết quả và đường dẫn bằng chứng; không ghi mật khẩu/token vào biên bản.

## Chuẩn bị

- Dựng theo [README](../README.md), chạy migrate, seed base/demo có chủ đích trên môi trường riêng
- Kiểm HTTPS/giờ UTC/NTP, sức khỏe DB/BE/FE/proxy, dung lượng bucket/report và quyền thiết bị
- Có Admin và ít nhất một UNIT, hai phiên trình duyệt tách biệt, một viewport mobile
- Đổi mật khẩu lần đầu; chuẩn bị file PDF/PNG/DOCX do nhóm tự tạo và link được phép dùng
- Xác nhận project/bucket private, tài khoản SMTP và thiết bị Push nếu bật; ZNS hiển thị chưa kích hoạt
- Backup DB cùng tệp trước diễn tập; giữ máy hoặc project restore riêng, không reset DB thật

## Lượt thực hiện

| Bước | ADMIN | UNIT và bằng chứng |
|---|---|---|
| 1 | Tạo danh sách Excel 1/34/100 dòng, tải và chỉnh tên/email thực tế | Preview không tạo user; confirm đủ số lượng, retry không trùng, mật khẩu chỉ xuất hiện một lần |
| 2 | Tạo kỳ năm chưa dùng, tổng 300, cây tiêu chí và ngưỡng mặc định hoặc 90/70/45/0 | Trước publish/start không lộ tiêu chí qua UI hoặc gọi API trực tiếp |
| 3 | Publish kỳ mở sau hai phút; xem audit và thử đổi ngưỡng sau publish | Đúng start thấy tiêu chí; đồng hồ máy sai không mở quyền trước hạn |
| 4 | Theo dõi dashboard của đúng kỳ | Lưu từng lá/batch, diễn giải, PDF/ảnh xem tại chỗ, Word tải, lỗi mạng giữ nháp |
| 5 | Mở hồ sơ so sánh; giảm điểm có lý do, hoàn tất lượt đầu | Nộp sớm khóa sửa; đúng deadline không còn ghi/upload/confirm được |
| 6 | Chọn đúng lá, ghi chú và hai mốc cuối tuần (ví dụ 45 phút); preview rồi gửi | Trước start chưa sửa; trong cửa sổ chỉ sửa mục yêu cầu; thay đổi rồi hoàn tác không tính là bổ sung |
| 7 | Kiểm nhắc deadline−24h chỉ khi nằm trong cửa sổ | Nộp bổ sung sớm hoặc để hết hạn; không tự chốt; nội dung lịch trong inbox/email dùng snapshot |
| 8 | Thẩm định cuối, preview/chốt; xem audit/history | UNIT thấy kết quả chính thức; hồ sơ chốt không sửa lại được |
| 9 | Đối chiếu ngưỡng ở self-summary/SQL/dashboard và XLSX/PDF/DOCX | File có tiếng Việt, đúng số/nhãn và hai mốc đã lưu; UNIT không tải báo cáo ADMIN |
| 10 | Restart BE rồi kiểm job/outbox không nhân đôi; backup/restore vào project mới | Login/me, minh chứng và báo cáo sau restore còn truy cập được, checksum DB/file khớp |

Kiểm kênh gửi: chỉ ghi SENT khi SMTP/Push endpoint đã nhận, và ghi thêm bằng chứng trên hộp thư/thiết bị thật nếu được bật. Provider giả/Mailpit phục vụ kiểm thử riêng; không dùng chúng thay cho chứng cứ gửi thật. Khi provider lỗi, UI giữ trạng thái thất bại/chờ retry và nghiệp vụ không tạo thành công giả.

## Hai lần diễn tập trên hạ tầng bảo vệ

| Lượt | URL và release | ADMIN/UNIT và thiết bị | Kết quả | Bằng chứng |
|---|---|---|---|---|
| 1 | Chờ môi trường được chỉ định | Chờ người thao tác và thiết bị | Chưa diễn tập tại hạ tầng bảo vệ | Chưa có |
| 2 | Chờ môi trường được chỉ định | Chờ người thao tác và thiết bị | Chưa diễn tập tại hạ tầng bảo vệ | Chưa có |

Browser tự động local và môi trường Docker local được ghi riêng trong biên bản kiểm thử, không tự điền hai hàng này.

Bộ slide đã chuẩn bị: [trình chiếu HTML](./bao-ve.html) và [PDF 12 trang](./BAO_VE_DO_AN.pdf). Nội dung slide là tài liệu trình bày, các mục cần môi trường thật vẫn giữ điều kiện ở trang nghiệm thu cuối.

## Dàn ý trình bày bảo vệ

1. Bài toán và vai trò: đơn vị tự đánh giá, Admin thẩm định, ẩn tiêu chí trước start
2. Kiến trúc React → HTTPS proxy → NestJS → PostgreSQL/Supabase; ba kênh Email/Push/ZNS tùy chọn
3. Schema: kỳ/năm, cây tiêu chí lá, hồ sơ/điểm, minh chứng, ngưỡng, history/audit, outbox
4. Quyền và thời gian: UTC, `[start,deadline)`, giờ DB sau khóa, trigger bảo vệ và snapshot một vòng
5. Transaction và cạnh tranh: thứ tự khóa kỳ → hồ sơ, rollback audit/outbox, idempotency import/retry
6. Job/outbox: lease/retry/dedupe, phục hồi sau restart và hạn thông báo
7. Demo golden path theo bảng trên, rồi mở bằng chứng unit/HTTP/PG/browser/coverage/CI đúng commit
8. Vận hành: role DB tối thiểu, rate limit, Swagger production tắt, private bucket, backup/restore
9. Phần mở rộng: Word→PDF, nhiều đợt/năm, nhiều replica với store rate limit chung; không gán chúng thành chức năng lõi đã có

Phân công trước buổi diễn: người 1 trình bày bài toán/ADMIN, người 2 thao tác UNIT/mobile, người 3 trình bày schema/transaction/kiểm thử và phục hồi. Điền tên thật khi nhóm chốt; không tự gán người nhận UI.

## Bàn giao

- Mã nguồn, lockfile, [contract](./API_CONTRACT.md), [API](<./danh sách api.md>), Swagger và [schema](../be/prisma/schema.prisma)
- Cấu hình không secret, hướng dẫn migrate/seed/start/test/deploy, danh mục kênh và trạng thái lỗi
- Release/image tag, backup đã thử restore và cách rollback; giao secret qua kênh quản lý riêng
- Bằng chứng chấp nhận từng mục, các phần đang chờ tài khoản/bucket/domain/thiết bị hoặc xác nhận UI
