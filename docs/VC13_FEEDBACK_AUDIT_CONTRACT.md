# VC13 — Phản hồi, lịch sử và audit

Mọi route dưới đây có tiền tố `/api/v1`, yêu cầu phiên đã đổi mật khẩu, `Cache-Control: no-store` và lỗi chuẩn `{statusCode,code,message,details}` bằng tiếng Việt

## Trao đổi và lịch sử

- `GET /evaluations/:evaluationId/feedback?page=1&pageSize=20` trả `{items,page,pageSize,total,canPost,allowedTypes,lockedReason}`
- Mỗi item gồm `id,evaluationId,authorId,authorName,type,content,createdAt`
- `POST /evaluations/:evaluationId/feedback` nhận duy nhất `{type,content}`, trả item như trên với HTTP 201
- ADMIN chỉ gửi `GENERAL` hoặc `EXPLANATION_REQUEST`; UNIT chỉ gửi `UNIT_REPLY` trên hồ sơ đơn vị mình
- `SUPPLEMENT_REQUEST` chỉ do use-case VC12 tạo, không được gửi qua route phản hồi
- Nội dung trim 1–4000 ký tự, văn bản thuần, từ chối thẻ HTML và ký tự điều khiển, React hiển thị như text
- Hồ sơ FINALIZED hoặc kỳ CLOSED khóa gửi cả hai vai trò, vẫn đọc được lịch sử
- UNIT trước giờ mở hoặc kỳ chưa công bố nhận 403 `FEEDBACK_LOCKED` khi đọc/gửi phản hồi để không lộ nội dung; giờ do PostgreSQL kiểm
- Chống spam dùng khóa giao dịch theo tác giả: mỗi hồ sơ cách ít nhất 30 giây, tối đa 20 phản hồi mỗi giờ trên toàn bộ hồ sơ của tác giả; vi phạm trả 429 `FEEDBACK_RATE_LIMITED`
- Phản hồi, audit `FEEDBACK_CREATED` và thông báo hộp thư đối tác commit cùng transaction; không đưa nội dung trao đổi vào kênh ngoài, không gọi provider trong HTTP
- `GET /evaluations/:evaluationId/status-history?page=1&pageSize=20` trả `{items,page,pageSize,total}`; item gồm `id,evaluationId,fromStatus,toStatus,actorId,actorName,comment,createdAt`, actor null có tên `Hệ thống`
- Cả hai danh sách sắp `createdAt DESC,id DESC`, pageSize 1–100; UUID sai 400, hồ sơ ngoài phạm vi 404, chưa đăng nhập 401
- Không có API sửa/xóa phản hồi hoặc lịch sử, DB bảo vệ append-only; phản hồi không thay điểm, hạn hoặc trạng thái hồ sơ

## Audit chỉ ADMIN

- `GET /admin/audit-logs?page=1&pageSize=20&actorId=&entity=&entityId=&action=&from=&to=` trả `{items,page,pageSize,total}`
- `GET /admin/audit-logs/:id` trả một item, không thấy trả 404
- Item gồm `id,actorId,actorName,action,entity,entityId,before,after,ip,createdAt`, không trả model User
- Lọc chính xác actorId/entity/entityId/action, `actorId=SYSTEM` chọn actor null; from/to là ISO có Z/offset, bao gồm hai đầu; from > to trả 400
- Sắp `createdAt DESC,id DESC`, pageSize 1–100, transaction đọc REPEATABLE READ để items/total cùng snapshot
- Snapshot che đệ quy password/hash/secret/token/key/credential/ciphertext/nonce/tag/cookie cả lúc ghi và đọc bản cũ; không nhận body ghi audit từ HTTP
- Route cũ `/audit-logs`, tham số `limit`, response `data/pagination` và `/audit-logs/stats` không thuộc giao ước mới; FE chuyển sang route chuẩn và bỏ chart không có API

## Giữ các quyết định đã chốt

Lịch bổ sung VC12 vẫn theo mục 1.4/5.4, chờ hỏi thầy và không dùng supplementHours; lịch tự chấm mọi ngày/giờ, quyền do BE quyết định
VC13 không thay Auth, Import Excel, storage hay kiến trúc Web Push/Email/ZNS; ZNS mặc định tắt, không gửi thật hoặc deploy môi trường dùng chung
