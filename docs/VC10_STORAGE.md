# Vận hành storage VC10

[Giao ước API](./VC10_STORAGE_CONTRACT.md) là nguồn chính thức cho FE/BE
NestJS + Prisma + PostgreSQL và ESM được giữ nguyên

## Dev cục bộ

Áp migration mới bằng `npx prisma migrate deploy` trên database đã chỉ định, không reset
Cấu hình backend:

```dotenv
STORAGE_ENABLED=true
STORAGE_PROVIDER=local
STORAGE_LOCAL_DIR=.private-storage
```

Thư mục được resolve theo working directory backend, cần quyền đọc/ghi và phải nằm ngoài static/web root
Thư mục được bỏ qua trong Git; không công khai bằng reverse proxy hoặc chia sẻ ổ đĩa
Mặc định storage tắt; khi tắt luồng link/diễn giải vẫn chạy, upload báo lỗi tiếng Việt theo từng tệp
FE nối URL ký tương đối theo `VITE_API_URL`, CORS backend phải cho origin frontend cụ thể

## Demo Supabase

Tạo bucket **private** riêng cho môi trường/người kiểm thử được chỉ định trước khi bật
Backend kiểm ACL bucket trước I/O và từ chối bucket public, không tự đổi quyền hoặc tạo bucket

```dotenv
STORAGE_ENABLED=true
STORAGE_PROVIDER=supabase
STORAGE_BUCKET=evidences
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_KEY=SERVICE_ROLE_KEY_CHI_O_BACKEND
```

Không đưa service key vào Vite, Git, URL, audit hoặc log
Production từ chối provider local; reverse proxy cần HTTPS, timeout và giới hạn request phù hợp 10 MiB/tệp
Bytes đi qua gateway Nest để kiểm file trước ghi, không tải trực tiếp từ client lên provider không được kiểm
Gateway cấp capability HMAC 5 phút cho upload, 2 phút cho download/preview, namespace token tách access JWT
URL đọc là bearer capability có thể chia sẻ trong thời gian ngắn, phải giữ riêng tư và xin URL mới qua JWT khi hết hạn
Không có route public lấy bytes bằng key; metadata hồ sơ không chứa key hoặc URL ký

## Dữ liệu và phục hồi lỗi

Migration `20261118120000_vc10_evidence_uploads` thêm EvidenceUpload và trigger kiểm phase, không sửa bảy migration cũ
FK NoAction, hai key unique, CHECK size/round/state/expiry; không backfill hoặc thay Evidence cũ
Mỗi file có UUID server, pending và final riêng; size khai báo dùng reservation quota, bytes thật được kiểm lại
FILE xác nhận idempotent theo uploadId, LINK dùng UUID mới cho mỗi lần tạo
Giới hạn 10 tệp/tiêu chí và 100 MiB/hồ sơ tính cả reservation sống, không có transaction phân tán DB/object store
Copy final trước insert Evidence, cập nhật CONFIRMED cùng audit; rollback còn PENDING để retry hoặc cleanup
DELETE commit metadata/audit/tombstone trước khi dọn bytes, provider lỗi giữ tombstone để thử lại
Cleanup mỗi 60 giây, tối đa 100 phiên/lượt, khóa kỳ → hồ sơ rồi đọc lại state; instance khác cùng dùng khóa DB
Cleanup CONFIRMED chỉ xóa pending và giữ bản ghi cho retry/xóa; không xóa final khi Evidence còn tồn tại
Cleanup lỗi một file không ngăn dọn file khác; thao tác người dùng chỉ dọn đúng phiên vừa xóa/hủy
Muốn dọn sau downtime chỉ cần khởi động backend cùng DB/kho cũ, không xóa thủ công key theo tên người dùng

Word không được convert trong VC10; DOC có cấu trúc OLE Word 97–2003/table stream, DOCX có OOXML/document XML
Chặn macro, mã hóa, MIME/extension/chữ ký sai và ZIP vượt giới hạn giải nén; JPG/PNG/PDF xem trước, Word tải xuống
Backend không fetch link ngoài, ảnh/PDF preview dùng blob trong bộ nhớ FE và được thu hồi khi đóng/rời trang
Quyền và round đọc snapshot server; bổ sung chỉ lá được yêu cầu, không sửa INITIAL hoặc tính bằng supplementHours

## Kiểm thử

Chạy build trước integration vì bài HTTP nạp ứng dụng từ dist

```powershell
npm run build
node --import tsx --test src/modules/evidences/evidences.controller.spec.ts src/modules/evidences/evidences.service.spec.ts
$env:VC10_TEST_DATABASE_URL='<URL database riêng tên vc10_test>'
node --import tsx --test test/integration/vc10.evidences.test.ts
```

Test HTTP từ chối tên DB khác vc10_test, dùng kho temp thật, thông báo Email/Push/ZNS đều tắt
Test giữ fixture DB sau chạy, không reset dữ liệu; có thể chạy lại vì tên/id fixture khác nhau
Test nâng cấp cần container PostgreSQL thử riêng đã chỉ định trong test, sinh database mới và không xóa DB cũ
CI có bước migrate và HTTP/PG/local storage thật; unit fake REST Supabase chỉ kiểm ACL/request, không thay bằng chứng provider thật
Chưa có bucket/môi trường demo được chỉ định trong lượt VC10 nên chưa xác nhận Supabase thật hoặc rollout DB dùng chung

Bài kiểm Chrome độc lập nằm tại [vc10.storage.mjs](../be/test/browser/vc10.storage.mjs), chạy sau integration với `VC10_BROWSER_FIXTURE_FILE` để lưu fixture
Chỉ định `VC10_PLAYWRIGHT_MODULE` đến module playwright-core đã cài và `VC10_BROWSER_EXECUTABLE` đến Chrome nếu khác đường dẫn mặc định Windows
Bài kiểm dùng FE 5180, BE 34010 trên loopback, tải ba tệp, preview PDF/PNG, đối chiếu bytes Word tải xuống, xóa bằng UI và reload
Không giả service/router/provider trong bài browser và không đưa Playwright thành dependency runtime của ứng dụng
