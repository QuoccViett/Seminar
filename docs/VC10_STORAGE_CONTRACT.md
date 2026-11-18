# VC10 — Minh chứng và storage

Giao ước này thay bản dự kiến tại API_CONTRACT: client dùng `criterionId/uploadId`, không gửi `criterionScoreId/storagePath/round`
Server suy ra score, round và key; JWT phải qua guard bắt đổi mật khẩu; ADMIN chỉ đọc, UNIT chỉ ghi hồ sơ của mình theo policy VC09
Trước mở không cấp metadata hoặc URL minh chứng cho UNIT, kể cả biết UUID

| API dưới `/api/v1` | Đầu vào và kết quả |
|---|---|
| POST `/evaluations/:id/evidences/upload-urls` | `{items:[{criterionId,fileName,mimeType,sizeBytes}]}` → 200 `{results:[{index,ok,data:{uploadId,uploadUrl,method:"PUT",requiredHeaders,expiresAt}}]}` |
| PUT URL đã ký | Bytes nguyên bản, Content-Type đúng requiredHeaders, không multipart/Bearer → 200 `{message}` tiếng Việt, tệp mới ở vùng chờ |
| POST `/evaluations/:id/evidences` | `{items:[{kind:"FILE",criterionId,uploadId,description?},{kind:"LINK",criterionId,externalUrl,description?}]}` → 200 `{results:[{index,ok,data:Evidence}]}` |
| GET `/evaluations/:id/evidences/:evidenceId` | Metadata Evidence cùng `downloadUrl/expiresAt`; LINK có hai trường này null |
| GET `/evaluations/:id/evidences/:evidenceId/preview` | JPG/PNG/PDF → `{url,mimeType,expiresAt}`; Word/LINK → 422 `PREVIEW_NOT_AVAILABLE` |
| DELETE `/evaluations/:id/evidences/:evidenceId` | 200 `{message}`, audit cùng transaction, object xóa sau commit |
| DELETE `/evaluations/:id/evidences/uploads/:uploadId` | Hủy upload chờ của chính người tải → 200 `{message}`, không sửa hồ sơ đã khóa |

`Evidence` gồm `id,kind,round,fileName,mimeType,sizeBytes,externalUrl,description,previewStatus,createdAt,canDelete`; sizeBytes là chuỗi hoặc null
Không trả storagePath, previewPath, uploaderId hoặc service key
Mỗi batch tối đa 10 phần tử; kết quả giữ thứ tự và lỗi riêng `{index,ok:false,error:ApiError}`; DTO sai cấu trúc trả 400 trước khi ghi
Confirm FILE idempotent theo uploadId; kiểm object thực tế và kiểm lại quyền/giờ/phase/round ngay khi ghi
URL cũ không vượt được deadline; INITIAL không bị sửa/xóa trong vòng SUPPLEMENT; lịch đọc snapshot, không dùng supplementHours

Giới hạn mặc định: 10 MiB/tệp, 10 FILE/tiêu chí, 100 MiB/hồ sơ, 20 LINK/tiêu chí; quota tính cả reservation PENDING còn hạn
Tên tệp tối đa 180 ký tự, mô tả 2000, link 2048; chỉ HTTP/HTTPS, không userinfo/ký tự điều khiển, không fetch URL ngoài
Chấp nhận JPG/JPEG, PNG, PDF, DOC và DOCX; kiểm MIME/extension/kích thước/chữ ký
DOC phải là OLE chứa stream WordDocument; DOCX phải là OOXML chứa word/document.xml, từ chối macro, mã hóa và gói giải nén quá lớn

URL upload 5 phút, URL đọc 2 phút; đường dẫn URL tương đối dùng cùng origin backend
URL ký là capability cần bảo mật, không lưu/log URL; cấp lại URL đọc luôn kiểm JWT và phạm vi
Storage dev cục bộ lưu bytes thật ngoài static web root; demo dùng Supabase private bucket, service key chỉ ở backend
Copy pending sang final trước commit; phiên pending giữ cả hai key để bù lỗi DB/audit hoặc tiến trình dừng
Cleanup chỉ xử lý PENDING hết hạn và DELETING, khóa kỳ/hồ sơ theo cùng thứ tự confirm; lỗi provider giữ bản ghi để retry
Thêm minh chứng SUPPLEMENT cập nhật supplementedAt bằng trigger cùng transaction
Không chuyển Word sang PDF trong VC10; Word tải xuống, ảnh/PDF xem inline; previewStatus của tệp gốc là NOT_REQUIRED
