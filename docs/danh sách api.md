# Danh sách API hiện hành

Đồng bộ ngày 24/11/2026 từ [OpenAPI](../be/docs/openapi.json): **94 thao tác trên 78 đường dẫn**. Các đường dẫn dưới đây đã có tiền tố /api/v1. Tham số trong ngoặc nhọn là path parameter; JSON và query dùng camelCase, phân trang page/pageSize. [API contract](./API_CONTRACT.md) mô tả request/response, lỗi và hậu điều kiện; Swagger dev/test ở /api/docs, production tắt.

## Quy ước chung

- ADMIN/UNIT cần Bearer access token; UNIT chỉ truy cập dữ liệu thuộc đơn vị mình. Tài khoản chưa đổi mật khẩu chỉ gọi me/change-password qua access, onboarding có token riêng.
- Login/refresh/logout dùng body riêng; logout public theo refresh token, không bắt access token hết hạn. Không có đăng ký công khai.
- Lỗi có statusCode/code/message/details, tiếng Việt, không trả passwordHash/tokenHash/raw SQL. 401 khi phiên không hợp lệ; 403/404 theo quyền/phạm vi; 409/422 theo contract.
- Cửa sổ [start,deadline) dùng giờ server/DB UTC, hiển thị giờ Việt Nam. Supplement nhận đủ hai mốc offset/Z, mọi ngày giờ, một vòng, retry giữ snapshot. Trước mở không trả criteria cho UNIT.
- Ngưỡng mặc định EXCELLENT >85, GOOD >=65, PASS >=50, FAIL >=0; cho sửa phần trăm theo kỳ trước publish, giữ bốn rating và FAIL=0, kiểm thứ tự hợp lệ. Các consumer đọc cùng cấu hình.
- Cấp mật khẩu từ INITIAL_ACCOUNT_PASSWORD, chỉ trả bản rõ một lần theo contract và bắt đổi; không sinh ngẫu nhiên thay chính sách cấp mới đã chốt. Generator Excel nằm ở FE, dùng lại import preview/confirm; không có API sinh danh sách riêng.
- Quyền/trạng thái/giờ được kiểm trong service và trigger SQL; scheduler/API reconcile trạng thái, trigger không tự chạy theo đồng hồ. Audit/history append-only, chuyển trạng thái và outbox nguyên tử.
- Storage bytes cần URL ký riêng, không công khai bucket. Report download cần cả JWT ADMIN và chữ ký. ZNS mặc định tắt; Email/Push chỉ gửi khi bật và đủ điều kiện.

## Health

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/health` | Public | Kiểm tra trạng thái API và cơ sở dữ liệu |

## Auth

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Public | Đăng nhập |
| GET | `/api/v1/auth/me` | ADMIN, UNIT | Xem tài khoản đang đăng nhập |
| POST | `/api/v1/auth/refresh` | Public | Làm mới access token (refresh token xoay vòng) |
| POST | `/api/v1/auth/logout` | Public | Đăng xuất và thu hồi refresh token |
| POST | `/api/v1/auth/change-password` | ADMIN, UNIT | Đổi mật khẩu khi được cấp tài khoản (chỉ được đổi ở tài khoản của chính mình) |

## Notifications

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/notifications` | ADMIN, UNIT | Xem danh sách thông báo trong hộp thư của tài khoản đang đăng nhập |
| GET | `/api/v1/notifications/unread-count` | ADMIN, UNIT | Đếm thông báo chưa đọc trong hộp thư của tài khoản đang đăng nhập |
| GET | `/api/v1/notifications/{notificationId}/deliveries` | ADMIN, UNIT | Xem trạng thái gửi từng kênh của thông báo thuộc hộp thư cá nhân |
| GET | `/api/v1/notifications/preferences` | ADMIN, UNIT | Xem tùy chọn kênh thông báo của tài khoản đang đăng nhập |
| PATCH | `/api/v1/notifications/preferences` | ADMIN, UNIT | Cập nhật tùy chọn kênh thông báo của tài khoản đang đăng nhập |
| PATCH | `/api/v1/notifications/{notificationId}/read` | ADMIN, UNIT | Đánh dấu một thông báo trong hộp thư cá nhân là đã đọc |
| POST | `/api/v1/notifications/read-all` | ADMIN, UNIT | Đánh dấu mọi thông báo chưa đọc trong hộp thư cá nhân |
| POST | `/api/v1/notifications/test` | ADMIN, UNIT | Tạo thông báo kiểm tra cho tài khoản đang đăng nhập và kênh đã chọn |

## Web Push

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/notifications/web-push/public-key` | Public | Khóa công khai Web Push |
| POST | `/api/v1/notifications/web-push/subscriptions` | ADMIN, UNIT | Đăng ký thiết bị hiện tại để nhận thông báo Web Push |
| DELETE | `/api/v1/notifications/web-push/subscriptions/current` | ADMIN, UNIT | Hủy đăng ký thiết bị Web Push của tài khoản hiện tại |

## Onboarding

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| POST | `/api/v1/onboarding/web-push/verify` | Token mời một lần | Kiểm liên kết mời Web Push |
| POST | `/api/v1/onboarding/web-push/subscriptions` | Token mời một lần | Đăng ký Web Push bằng liên kết mời |

## Users

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/users/import/template` | ADMIN | Tải tệp mẫu nhập tài khoản UNIT |
| POST | `/api/v1/users/import/preview` | ADMIN | Kiểm tra và xem trước tệp Excel tài khoản UNIT |
| POST | `/api/v1/users/import/{importId}/confirm` | ADMIN | Tạo các tài khoản đã xem trước trong một giao dịch |
| GET | `/api/v1/users` | ADMIN | Danh sách tài khoản, lọc và phân trang |
| POST | `/api/v1/users` | ADMIN | Tạo tài khoản ADMIN hoặc UNIT (trả mật khẩu tạm một lần) |
| GET | `/api/v1/users/{id}` | ADMIN, UNIT | Xem thông tin tài khoản (UNIT chỉ xem chính mình) |
| PATCH | `/api/v1/users/{id}` | ADMIN, UNIT | Cập nhật thông tin tài khoản (UNIT chỉ sửa chính mình) |
| POST | `/api/v1/users/{id}/reset-password` | ADMIN | Đặt lại mật khẩu cho UNIT nếu quên mật khẩu và thu hồi phiên cũ |
| GET | `/api/v1/users/{id}/credential-deliveries` | ADMIN | Trạng thái cấp thông tin đăng nhập theo kênh |
| POST | `/api/v1/users/{id}/credential-deliveries/confirm-email` | ADMIN | Xác nhận email nhận thông tin đăng nhập |
| POST | `/api/v1/users/{id}/credential-deliveries/retry` | ADMIN | Thử lại kênh gửi thông tin đăng nhập đã thất bại |
| PATCH | `/api/v1/users/{id}/status` | ADMIN | Khóa hoặc kích hoạt tài khoản |

## Units

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/units` | ADMIN, UNIT | Danh sách đơn vị (UNIT chỉ thấy đơn vị của mình) |
| POST | `/api/v1/units` | ADMIN | Tạo đơn vị |
| GET | `/api/v1/units/{id}/users` | ADMIN, UNIT | Danh sách tài khoản thuộc đơn vị (UNIT chỉ xem đơn vị của mình) |
| GET | `/api/v1/units/{id}` | ADMIN, UNIT | Chi tiết đơn vị (UNIT chỉ xem đơn vị của mình) |
| PATCH | `/api/v1/units/{id}` | ADMIN | Cập nhật đơn vị |

## Evaluation Periods

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| POST | `/api/v1/evaluation-periods/supplement-schedule/preview` | ADMIN | Xem trước giờ mở và hạn bổ sung với hai mốc Admin tự chọn |
| GET | `/api/v1/evaluation-periods/{id}/phase-options` | ADMIN | Xem các giai đoạn có thể chuyển tới và điều kiện còn thiếu |
| POST | `/api/v1/evaluation-periods/{id}/transition-phase` | ADMIN | Chuyển giai đoạn kỳ đánh giá khi đáp ứng các điều kiện nghiệp vụ |
| GET | `/api/v1/evaluation-periods` | ADMIN, UNIT | Xem danh sách đợt đánh giá (UNIT chỉ thấy kỳ đã công bố) |
| POST | `/api/v1/evaluation-periods` | ADMIN | Tạo đợt đánh giá ở trạng thái nháp |
| GET | `/api/v1/evaluation-periods/{id}` | ADMIN, UNIT | Xem chi tiết đợt đánh giá theo quyền và thời điểm mở |
| PATCH | `/api/v1/evaluation-periods/{id}` | ADMIN | Cập nhật cấu hình đợt đánh giá trước khi kỳ mở |
| DELETE | `/api/v1/evaluation-periods/{id}` | ADMIN | Xóa đợt đánh giá nháp chưa phát sinh hồ sơ hoặc báo cáo |
| GET | `/api/v1/evaluation-periods/{id}/thresholds` | ADMIN, UNIT | Xem ngưỡng xếp loại theo quyền và thời điểm mở của kỳ |
| PUT | `/api/v1/evaluation-periods/{id}/thresholds` | ADMIN | Tạo hoặc thay thế bộ ngưỡng xếp loại của kỳ chưa công bố |
| POST | `/api/v1/evaluation-periods/{id}/publish` | ADMIN | Công bố đợt đánh giá sau khi cấu hình vượt qua kiểm tra |
| GET | `/api/v1/evaluation-periods/{id}/publish-check` | ADMIN | Kiểm tra các điều kiện cần hoàn tất trước khi công bố kỳ |

## Criteria

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/evaluation-periods/{periodId}/criteria` | ADMIN, UNIT | Xem cây tiêu chí của kỳ đánh giá theo quyền và thời điểm mở |
| POST | `/api/v1/evaluation-periods/{periodId}/criteria` | ADMIN | Thêm tiêu chí vào cấu hình kỳ đánh giá còn được phép chỉnh sửa |
| PATCH | `/api/v1/evaluation-periods/{periodId}/criteria/{id}` | ADMIN | Cập nhật tiêu chí trong cấu hình kỳ đánh giá còn được phép chỉnh sửa |
| DELETE | `/api/v1/evaluation-periods/{periodId}/criteria/{id}` | ADMIN | Xóa tiêu chí nháp khi không có tiêu chí con hoặc dữ liệu điểm |
| PATCH | `/api/v1/criteria/{id}` | ADMIN | Sửa tiêu chí nháp theo mã tiêu chí |
| DELETE | `/api/v1/criteria/{id}` | ADMIN | Xóa tiêu chí nháp theo mã tiêu chí khi không có dữ liệu phụ thuộc |

## Audit Logs

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/admin/audit-logs` | ADMIN | Tìm và lọc nhật ký hoạt động theo người thực hiện, hành động, đối tượng hoặc thời gian |
| GET | `/api/v1/admin/audit-logs/{id}` | ADMIN | Xem chi tiết giá trị trước và sau của một thao tác |

## Dashboard

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/admin/dashboard` | ADMIN | Xem tiến độ, trạng thái và kết quả tổng quan của một đợt đánh giá |
| GET | `/api/v1/admin/dashboard/criteria-deductions` | ADMIN | Xem danh sách tiêu chí có điểm thẩm định thấp hơn điểm tự chấm |
| GET | `/api/v1/admin/dashboard/criteria-deductions/{criterionId}` | ADMIN | Xem các đơn vị bị trừ điểm ở một tiêu chí thuộc kỳ đã chọn |
| GET | `/api/v1/admin/dashboard/leaderboard` | ADMIN | Xem bảng xếp hạng hiện tại của các đơn vị trong một đợt đánh giá |
| GET | `/api/v1/admin/dashboard/score-distribution` | ADMIN | Xem phân bố xếp loại của các hồ sơ đã chốt trong một đợt đánh giá |

## Reports

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| POST | `/api/v1/admin/reports/exports` | ADMIN | Tạo báo cáo tổng hợp Excel hoặc biên bản thẩm định PDF/Word |
| GET | `/api/v1/admin/reports/exports` | ADMIN | Xem và lọc lịch sử các báo cáo đã xuất |
| GET | `/api/v1/admin/reports/exports/{id}/download` | ADMIN | Tải tệp báo cáo bằng liên kết ký ngắn hạn còn hiệu lực |
| GET | `/api/v1/admin/reports/exports/{id}` | ADMIN | Xem thông tin và cấp lại liên kết tải cho một báo cáo |

## Evaluations

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/evaluations` | ADMIN, UNIT | Xem danh sách hồ sơ theo quyền và trạng thái hiệu lực |
| POST | `/api/v1/evaluations` | ADMIN, UNIT | Tạo bù hồ sơ cho đơn vị trong kỳ đã công bố và khởi tạo các điểm còn trống |
| GET | `/api/v1/evaluations/{evaluationId}` | ADMIN, UNIT | Xem chi tiết hồ sơ và quyền thao tác trên từng tiêu chí |
| GET | `/api/v1/evaluations/{evaluationId}/score-summary` | ADMIN, UNIT | Xem tổng điểm và xếp loại tự chấm tạm tính do máy chủ tính |
| PUT | `/api/v1/evaluations/{evaluationId}/scores/{criterionId}/self` | UNIT | Lưu điểm hoặc diễn giải tự chấm cho một tiêu chí lá còn mở |
| PUT | `/api/v1/evaluations/{evaluationId}/scores/self-batch` | UNIT | Lưu điểm tự chấm hàng loạt và trả kết quả riêng cho từng tiêu chí |
| POST | `/api/v1/evaluations/{evaluationId}/submit` | UNIT | Nộp hồ sơ tự chấm để khóa chỉnh sửa và chuyển sang thẩm định |
| POST | `/api/v1/evaluations/{evaluationId}/supplement-submit` | UNIT | Nộp hồ sơ bổ sung sau khi cập nhật các nội dung được yêu cầu |

## Evaluation Reviews

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/admin/evaluations/{evaluationId}/review` | ADMIN | Xem và đối chiếu nội dung tự chấm, thẩm định và bổ sung của hồ sơ |
| PUT | `/api/v1/admin/evaluations/{evaluationId}/scores/{criterionId}/review` | ADMIN | Ghi điểm và nhận xét thẩm định cho một tiêu chí lá |
| POST | `/api/v1/admin/evaluations/{evaluationId}/accept-all` | ADMIN | Chấp nhận các điểm tự chấm chưa được thẩm định của hồ sơ |
| POST | `/api/v1/admin/evaluations/{evaluationId}/first-review-complete` | ADMIN | Hoàn tất lượt thẩm định đầu tiên của hồ sơ |
| POST | `/api/v1/admin/evaluations/{evaluationId}/finalize` | ADMIN | Chốt kết quả cuối cùng cho một hồ sơ đủ điều kiện |
| POST | `/api/v1/admin/evaluations/{evaluationId}/supplement-request` | ADMIN | Yêu cầu đơn vị bổ sung các tiêu chí được chọn theo lịch đã xem trước |
| PUT | `/api/v1/admin/evaluations/{evaluationId}/scores/review-batch` | ADMIN | Thẩm định hàng loạt tiêu chí và nhận kết quả riêng từng mục |
| POST | `/api/v1/admin/evaluations/finalize-batch` | ADMIN | Chốt hàng loạt hồ sơ với kết quả riêng cho từng hồ sơ |
| POST | `/api/v1/admin/evaluations/finalize-preview` | ADMIN | Xem trước điều kiện và kết quả dự kiến khi chốt hàng loạt hồ sơ |

## Feedback and History

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| GET | `/api/v1/evaluations/{evaluationId}/feedback` | ADMIN, UNIT | Xem trao đổi của hồ sơ và các loại phản hồi được phép gửi |
| POST | `/api/v1/evaluations/{evaluationId}/feedback` | ADMIN, UNIT | Gửi phản hồi văn bản thuần theo vai trò và trạng thái hồ sơ |
| GET | `/api/v1/evaluations/{evaluationId}/status-history` | ADMIN, UNIT | Xem lịch sử chuyển trạng thái của hồ sơ |

## Evidence

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| POST | `/api/v1/evaluations/{evaluationId}/evidences/upload-urls` | UNIT | Xin URL tải lên cho nhiều tệp minh chứng của hồ sơ |
| POST | `/api/v1/evaluations/{evaluationId}/evidences` | UNIT | Xác nhận các tệp hoặc liên kết minh chứng đã tải lên |
| DELETE | `/api/v1/evaluations/{evaluationId}/evidences/uploads/{uploadId}` | UNIT | Hủy phiên tải minh chứng chưa được xác nhận |
| GET | `/api/v1/evaluations/{evaluationId}/evidences/{evidenceId}` | ADMIN, UNIT | Xem thông tin minh chứng và xin liên kết tải tệp theo quyền hồ sơ |
| DELETE | `/api/v1/evaluations/{evaluationId}/evidences/{evidenceId}` | UNIT | Xóa minh chứng khi hồ sơ và lượt hiện tại còn cho phép chỉnh sửa |
| GET | `/api/v1/evaluations/{evaluationId}/evidences/{evidenceId}/preview` | ADMIN, UNIT | Xin liên kết xem trước ảnh hoặc PDF theo quyền hồ sơ |

## Signed Evidence Storage

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| PUT | `/api/v1/storage/uploads/{uploadId}` | URL ký ngắn hạn | Tải bytes bằng liên kết ngắn hạn đã được cấp |
| GET | `/api/v1/storage/files/{evidenceId}` | URL ký ngắn hạn | Đọc bytes qua liên kết tải hoặc xem trước đã ký |

## Scheduler

| Method | Đường dẫn | Quyền / xác minh | Chức năng |
|---|---|---|---|
| POST | `/api/v1/admin/scheduler/run` | ADMIN | Chạy thủ công một lượt quét lịch trong môi trường demo đã bật công cụ |

## Giao ước chi tiết và nghiệm thu

- [Storage VC10](./VC10_STORAGE_CONTRACT.md): upload reservation → bytes → confirm, MIME/quota/round, preview và tombstone/cleanup.
- [Review VC12](./VC12_REVIEW_CONTRACT.md): first-review-complete, supplement-request/submit, finalize-preview/batch, một vòng bổ sung và snapshot.
- [Feedback/audit VC13](./VC13_FEEDBACK_AUDIT_CONTRACT.md): loại phản hồi, khóa sau chốt, history và lọc audit.
- [Báo cáo VC15](./VC15_REPORTS.md): XLSX tổng hợp, PDF/DOCX từng hồ sơ, số/nhãn/ngưỡng và chữ ký tải.
- [Bằng chứng hiện hành](./HOAN_THIEN_2026-11-24.md), [bảo mật](./SECURITY_REMEDIATION.md), [diễn tập](./DEMO_NGHIEM_THU.md): phân biệt local/CI với bucket, thiết bị và môi trường thật.
