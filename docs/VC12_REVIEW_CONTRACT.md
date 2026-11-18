# Hợp đồng VC12 — Thẩm định, bổ sung và chốt điểm

Các endpoint dưới `/api/v1/admin/evaluations` chỉ dành cho ADMIN đã đổi mật khẩu; endpoint nộp bổ sung dưới `/api/v1/evaluations` chỉ dành cho UNIT chính chủ. Mọi quyền và thời gian lấy từ backend/PostgreSQL, UUID và DTO áp dụng whitelist, không nhận người duyệt, tổng điểm hoặc trạng thái từ client.

## Đọc và thẩm định

- `GET /admin/evaluations/:evaluationId/review` trả metadata, cây tiêu chí và từng lá gồm self/admin, người và giờ duyệt, yêu cầu bổ sung, minh chứng có round, snapshot trước bổ sung và cờ `supplementChanged`. Trả `permissions` do server tính: `canReview`, `canCompleteFirstReview`, `canRequestSupplement`, `canFinalize`; mỗi thao tác ghi vẫn kiểm lại sau khóa
- `PUT /admin/evaluations/:evaluationId/scores/:criterionId/review`: `{adminScore,adminComment?}`, điểm hữu hạn 0..max, tối đa hai chữ số thập phân. Lý do không trắng bắt buộc khi khác self hoặc self chưa có. Trả điểm, lý do, actor và thời gian server đã lưu
- `PUT /admin/evaluations/:evaluationId/scores/review-batch`: `{items:[{criterionId,adminScore,adminComment?}]}`, 1..100 mục không trùng, mỗi mục có transaction riêng, trả `{results:[{criterionId,ok,data|error}]}`
- `POST /admin/evaluations/:evaluationId/accept-all`, body `{}`: chỉ chấp nhận lá có self và chưa có Admin, không ghi đè ô đã duyệt
- `POST /admin/evaluations/:evaluationId/first-review-complete`, body `{}`: PENDING_REVIEW trong FIRST_REVIEW/SUPPLEMENT, mọi lá có điểm Admin; ghi `firstReviewedAt` một lần, không tự chốt. Retry cùng lệnh trả thời điểm đã lưu

Chấm điểm được phép trong FIRST_REVIEW/SUPPLEMENT/FINAL_REVIEW với PENDING_REVIEW/SUPPLEMENT_SUBMITTED/SUPPLEMENT_EXPIRED. Yêu cầu hết hạn được reconcile trước khi kiểm quyền; hồ sơ còn vòng bổ sung mở không được thẩm định. Mỗi thay đổi lưu audit điểm cũ, mới, lý do, người duyệt và giờ cùng transaction.

## Một vòng bổ sung

`POST /admin/evaluations/:evaluationId/supplement-request` nhận `{supplementStartAt,items:[{criterionId,note}]}`, mỗi ghi chú riêng không trắng. Hồ sơ phải PENDING_REVIEW, hoàn tất lượt đầu, chưa từng yêu cầu. Backend khóa kỳ rồi hồ sơ, lấy giờ DB sau khi khóa và kiểm mốc mở không trước giờ yêu cầu.

Lịch tạm chờ giảng viên xác nhận: mở thứ Hai–thứ Sáu theo giờ Việt Nam; thứ Hai–thứ Năm đóng hết ngày kế tiếp, thứ Sáu đóng hết chính ngày; deadline loại trừ tại 00:00 sau ngày kết thúc. Không dùng `supplementHours`. Lưu `supplementRequestedAt`, `supplementStartAt`, `supplementDeadline` duy nhất; cùng transaction lưu baseline từng lá, flags, feedback, history, audit và outbox. Nếu kỳ còn FIRST_REVIEW, chuyển SUPPLEMENT trong cùng transaction qua use-case giai đoạn dùng chung.

Retry đúng lịch và danh sách ghi chú trả snapshot đã lưu, không tạo thêm vòng hoặc dời hạn. Payload khác sau khi đã yêu cầu trả `409 SUPPLEMENT_ALREADY_REQUESTED`.

UNIT chỉ đổi các lá được yêu cầu trong `[start,deadline)`. Điểm/diễn giải thay đổi hoặc thêm/xóa minh chứng hợp lệ làm mất hiệu lực điểm, lý do và người duyệt cũ; snapshot và audit giữ thông tin trước thay đổi. Minh chứng INITIAL bất biến trong vòng bổ sung.

`POST /evaluations/:evaluationId/supplement-submit`, body `{}`: mỗi lá yêu cầu phải có nội dung cuối khác baseline về selfScore, selfNote hoặc tập minh chứng đã xác nhận. Sửa rồi hoàn tác, thêm rồi xóa hết tệp không được coi là bổ sung. Mốc `updatedAt` hay `supplementedAt` riêng lẻ không đủ điều kiện. Trả metadata SUPPLEMENT_SUBMITTED, khóa sửa và ghi history/audit/outbox cùng transaction. Retry sau nộp trả snapshot cũ. Đúng deadline trả `403 DEADLINE_PASSED`, kể cả scheduler chưa chạy; reconcile SUPPLEMENT_EXPIRED và không tự chốt.

Migration mới chụp nội dung hiện tại làm baseline cho các vòng đang mở chưa có baseline khi nâng cấp; giữ toàn bộ điểm, nội dung và minh chứng. Các hồ sơ này cần có thay đổi thực tế so với nội dung tại lúc nâng cấp trước khi nộp, không suy đoán lịch sử bị thiếu.

## Xem trước và chốt

- `POST /admin/evaluations/finalize-preview`: `{evaluationIds:[uuid,...]}`, 1..100 ID không trùng, trả kết quả riêng gồm `unitName`, `periodName`, `score`, `percent`, `rating`, `ratingLabel`, `canFinalize`, `message`, `serverTime`; không coi preview là quyền ghi
- `POST /admin/evaluations/:evaluationId/finalize`, body `{}`: FINAL_REVIEW, đã hoàn tất lượt đầu, trạng thái PENDING_REVIEW/SUPPLEMENT_SUBMITTED/SUPPLEMENT_EXPIRED, không còn vòng mở
- `POST /admin/evaluations/finalize-batch`: danh sách ID như preview, mỗi hồ sơ transaction riêng, kết quả `{results:[{evaluationId,ok,data|error}]}`; một lỗi không hủy kết quả khác

Kết quả chốt thành công gồm `finalScore`, `finalPercent`, `finalRating`, `finalRatingLabel`, `finalizedById`, `finalizedAt`. Nhãn lấy từ ngưỡng của kỳ ngay trong transaction chốt; FE dùng kết quả này thay vì giữ nhãn preview có thể đã cũ khi một Admin khác sửa điểm trước khi chốt.

Chốt dùng tổng Decimal `adminScore ?? selfScore ?? 0` và cùng hàm SQL `fn_rating_for_percent` như view, phân loại trước làm tròn và lưu phần trăm đầy đủ. Khóa kỳ rồi hồ sơ, ghi FINALIZED, finalScore/finalPercent/finalRating, người/giờ chốt, history/audit/outbox nguyên tử. Chốt lặp trả REVIEW_LOCKED; hai lệnh cạnh tranh chỉ một thành công. CLOSED chỉ qua endpoint chuyển giai đoạn khi mọi hồ sơ đã FINALIZED có đủ kết quả.

Lỗi HTTP và từng ô batch dùng `{statusCode,code,message,details}`, thông điệp tiếng Việt có dấu; không trả đối tượng Prisma/SQL/provider. Các mã ổn định: REVIEW_LOCKED, DEADLINE_PASSED, INCOMPLETE_SUPPLEMENT, SUPPLEMENT_ALREADY_REQUESTED, VALIDATION_ERROR, NOT_FOUND, BUSINESS_RULE_VIOLATION.
