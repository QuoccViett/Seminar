# Triển khai FE trên Vercel, BE trên Render

Áp dụng cho repository `giahan358/Seminar`, nhánh `main`. Quy chuẩn FE theo [UI_STYLE_GUIDE](./UI_STYLE_GUIDE.md), không chờ gộp hoặc xác nhận nhánh Huy. Chọn commit có đủ CI xanh làm bản triển khai; ghi SHA và URL vào [biên bản nghiệm thu](./DEMO_NGHIEM_THU.md).

## 1. Mô hình và tài nguyên

| Thành phần | Nơi chạy / cấu hình |
| --- | --- |
| FE React/Vite | Vercel, Root Directory `fe` |
| BE NestJS | Render Web Service Node, Root Directory `be`, một instance |
| PostgreSQL | DB riêng của ứng dụng; chọn vùng gần BE, kết nối TLS theo provider |
| Minh chứng | Supabase bucket **private** `evidences` |
| Báo cáo XLSX/PDF/DOCX | Render persistent disk `/var/data`, không nằm trong thư mục public |
| Email | SMTP có TLS, tài khoản gửi và hộp thư nhận thử do nhóm quản lý |

Mẫu [render.yaml](../render.yaml) chọn **Starter + disk 1 GB, có tính phí**. Việc push file không tự tạo tài nguyên; chỉ tạo khi bạn thao tác trên Render. Không cần chọn Docker ở Render với hướng dẫn này; bộ [Docker/Compose](../deploy/compose.yml) vẫn dùng được cho máy chủ riêng.

[Render Free](https://render.com/docs/free) chặn SMTP 25/465/587, không hỗ trợ disk và ngủ sau 15 phút không có inbound. Với code hiện dùng SMTP và scheduler trong tiến trình, chọn dịch vụ có trả phí để demo đủ luồng. Nếu bắt buộc miễn phí, phải bổ sung adapter email qua HTTPS, nơi lưu báo cáo ngoài và giải pháp scheduler; chỉ đổi biến môi trường chưa đủ. Tệp local mất khi restart/redeploy nếu không có [persistent disk](https://render.com/docs/disks).

## 2. Chuẩn bị DB và bucket trước khi chạy BE

Tạo PostgreSQL trống dành riêng ứng dụng, không dùng DB đang có dữ liệu khác. Giữ URL owner/migration trên máy quản trị; Render runtime sẽ dùng role `seminar_app` với quyền tối thiểu. Mật khẩu trong URL phải được URL-encode. Nếu dùng Supabase, lấy connection string trong Connect; dùng direct connection khi mạng hỗ trợ hoặc session pooler khi cần IPv4. Không dùng transaction pooler cho migration. Xem [hướng dẫn kết nối Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

Trên máy quản trị có Node 22 và đã checkout đúng commit, vào thư mục BE, đặt `DATABASE_URL` của owner trong môi trường riêng, rồi chạy:

```powershell
npm ci --include=dev
npm run db:generate
npm run db:migrate:deploy
```

Không chạy `migrate dev`, `db push`, reset hoặc seed demo trên DB thật. Dùng SQL editor/psql của **chính DB này**, đăng nhập bằng migration owner, thay mật khẩu mẫu dưới đây bằng mật khẩu riêng rồi cấp quyền:

```sql
CREATE ROLE seminar_app LOGIN PASSWORD 'THAY_BANG_MAT_KHAU_NGAU_NHIEN'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO seminar_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO seminar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO seminar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO seminar_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, status_histories FROM seminar_app;
REVOKE ALL ON _prisma_migrations FROM seminar_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO seminar_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO seminar_app;
```

Đoạn CREATE ROLE chỉ chạy khi role chưa tồn tại; những lần cập nhật sau dùng role cũ, không đổi mật khẩu ngoài ý muốn. Default privileges phải được tạo dưới đúng role sẽ chạy migration. Khi đổi schema, backup và migrate bằng owner trước rollout, đối chiếu lại quyền append-only của audit/history. Không đưa URL owner vào biến runtime Render và không dùng script quyền Compose nguyên bản với DB cloud khác tên `seminar`.

Nếu dùng PostgreSQL Supabase: ứng dụng truy cập DB qua BE, không gọi Supabase Data API từ FE. Trong API settings tắt Data API cho project riêng này hoặc bỏ schema `public` khỏi exposed schemas; không cấp quyền đọc bảng nghiệp vụ cho `anon`/`authenticated`. Bật RLS với policy thích hợp nếu chủ động mở lại API; không mở bảng chỉ để làm hết cảnh báo dashboard. Xem [bảo vệ Data API](https://supabase.com/docs/guides/database/hardening-data-api).

Tại Supabase Storage, tạo bucket `evidences`, giữ Public **tắt**. Lấy project URL và khóa server `service_role` tương thích REST hiện tại; chỉ đặt ở BE, không dùng khóa anon/publishable và không tạo biến `VITE_SUPABASE_KEY`. Khóa này có quyền cao, không đưa vào Git hay gửi qua chat. Xem [kiểm soát truy cập Storage](https://supabase.com/docs/guides/storage/security/access-control).

## 3. Tạo Vercel để lấy URL FE

Vercel → Add New → Project → chọn repository → Production Branch `main`:

| Mục | Giá trị |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `fe` |
| Node.js Version | 22.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Đặt biến môi trường Production:

```dotenv
VITE_API_URL=https://TEN-BE.onrender.com
VITE_API_MOCKING=disabled
```

`VITE_API_URL` chỉ chứa origin BE, **không thêm `/api/v1`**, không dấu `/` cuối; client tự nối đường dẫn API. Lúc BE chưa tồn tại, FE vẫn build được nhưng chưa đăng nhập được. Lấy URL Production cố định, ví dụ `https://TEN-FE.vercel.app`, để cấu hình BE ở bước sau. Sau khi có URL BE thật, sửa biến và **Redeploy** FE vì Vite đọc biến lúc build.

[fe/vercel.json](../fe/vercel.json) đã khai báo build và SPA rewrite để refresh/mở trực tiếp `/admin/records` hoặc `/unit/dashboard` không bị 404 từ hosting. Xem [Vite trên Vercel](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas). Preview có URL khác Production: dùng BE test/CORS riêng khi cần, không cho phép wildcard CORS.

## 4. Tạo Render BE

Cách tự điền: Render → New → Web Service → kết nối GitHub repo. Hoặc New → Blueprint, chọn repository và file [render.yaml](../render.yaml), kiểm chi phí trước khi tạo. Blueprint chỉ tạo BE/disk, không tạo DB, bucket hay Vercel.

| Mục | Giá trị |
| --- | --- |
| Branch | `main` |
| Language / Runtime | Node |
| Root Directory | `be` |
| Region | Gần DB, mẫu dùng Singapore |
| Instance Type | Starter hoặc cao hơn, một instance |
| Build Command | `npm ci --include=dev && npm run db:generate && npm run build` |
| Pre-Deploy Command | Để trống: migration chạy tách bằng owner ở bước 2 |
| Start Command | `npm start` |
| Health Check Path | `/api/v1/health` |
| Auto-Deploy | After CI Checks Pass |
| Disk | Mount `/var/data`, tối thiểu 1 GB cho demo |

`--include=dev` cần thiết để build TypeScript/Prisma khi `NODE_ENV=production`. Không prune dev dependencies nếu vẫn dùng Shell để seed/kiểm Supabase. BE lắng nghe `0.0.0.0` và cổng `PORT` do Render cấp; không buộc cổng 3000. Đặt `NODE_VERSION=22` để giữ cùng major với CI. Xem [Node version](https://render.com/docs/node-version) và [web service](https://render.com/docs/web-services).

Các biến bắt buộc/khuyến nghị trên Render → Environment:

| Biến | Giá trị |
| --- | --- |
| `NODE_VERSION` / `NODE_ENV` / `TZ` | `22` / `production` / `UTC` |
| `DATABASE_URL` | URL TLS của role runtime `seminar_app`, không phải owner |
| `WEB_ORIGINS` | Origin FE chính xác, ví dụ `https://TEN-FE.vercel.app`, không `/` cuối |
| `PUBLIC_APP_URL` | Cùng origin FE; dùng cho link trong thông báo |
| `JWT_SECRET` | Chuỗi ngẫu nhiên riêng, tối thiểu 32 ký tự; Blueprint tự sinh |
| `INITIAL_ACCOUNT_PASSWORD` | Mật khẩu ban đầu ngẫu nhiên riêng, tối thiểu 8 ký tự |
| `RATE_LIMIT_ENABLED` | `true` |
| `SWAGGER_ENABLED` / `ENABLE_DEMO_TOOLS` | `false` / `false` |
| `STORAGE_ENABLED` / `STORAGE_PROVIDER` | `true` / `supabase` |
| `STORAGE_BUCKET` / `SUPABASE_URL` / `SUPABASE_KEY` | Bucket private và thông tin BE ở bước 2 |
| `REPORT_EXPORT_DIR` | `/var/data/report-exports` |
| `EMAIL_ENABLED` / `WEB_PUSH_ENABLED` / `ZALO_ZNS_ENABLED` | Ban đầu đều `false` |

Không đặt thêm `CORS_ORIGINS` khác `WEB_ORIGINS`: nếu tồn tại thì CORS_ORIGINS được ưu tiên. `TRUST_PROXY` ban đầu bỏ trống; bộ đếm IP sẽ dùng peer proxy và có thể gom nhiều người dùng. Chỉ đặt mạng proxy CIDR sau khi xác minh topology thực tế; ứng dụng chủ động từ chối `true`, `1` hoặc wildcard. Đừng tắt rate limit để khắc phục. Mẫu dành một replica, chưa có store bộ đếm dùng chung cho nhiều replica.

Render tự cấp HTTPS; không chạy Caddy/Nginx Compose trong Web Service Node này. Có disk thì deploy có thể gián đoạn ngắn; lên lịch demo sau khi health xanh. Theo [cơ chế deploy Render](https://render.com/docs/deploys), chọn After CI Checks Pass để bản push lỗi CI không tự được rollout.

## 5. Tạo Admin và bật mail thật

Sau khi DB/BE khỏe, trong Render Shell (thư mục BE) đặt `SEED_ADMIN_USERNAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` qua Environment bảo mật, rồi chạy một lần:

```sh
npm run db:seed:base
```

Lệnh chỉ tạo Admin nếu chưa có, không tự reset người đã tồn tại; đăng nhập FE và đổi mật khẩu lần đầu. Sau seed xóa biến `SEED_ADMIN_PASSWORD` nếu không còn cần. Seed base không gửi email và không tạo 34 đơn vị demo; nhập tài khoản qua luồng preview/confirm. Bộ demo với kho local không dùng trực tiếp cho môi trường production/Supabase.

Để bật email, bổ sung Environment rồi redeploy BE:

```dotenv
EMAIL_ENABLED=true
SMTP_HOST=HOST_SMTP_CUA_NHA_CUNG_CAP
SMTP_PORT=587
SMTP_SECURE=false
SMTP_AUTH_REQUIRED=true
SMTP_ALLOW_INSECURE_LOCAL=false
SMTP_USER=TAI_KHOAN_SMTP
SMTP_PASSWORD=MAT_KHAU_UNG_DUNG_HOAC_SMTP
MAIL_FROM=dia-chi-gui@domain-cua-ban.vn
CREDENTIALS_ENCRYPTION_KEY=KHOA_32_BYTE_BASE64
```

Port 587 dùng STARTTLS (`SMTP_SECURE=false`); nếu provider yêu cầu 465 thì đặt `SMTP_SECURE=true`. MAIL_FROM là địa chỉ email thuần, phải được provider cho phép gửi. Nếu dùng Gmail, dùng App Password khi tài khoản đủ điều kiện, không dùng mật khẩu đăng nhập thường; cách tạo xem [hướng dẫn Google](https://support.google.com/accounts/answer/185833). Không đổi TLS thành insecure.

Bật Email và khóa mã hóa **trước khi tạo/import tài khoản nhận thử**. Tài khoản đã tạo khi thiếu khóa chỉ có hash mật khẩu nên không thể gửi lại mật khẩu cũ; dùng Đặt lại mật khẩu để tạo dispatch mới rồi xác nhận đúng địa chỉ email. Trạng thái `EMAIL_UNCONFIRMED` cần thao tác Xác nhận email trên giao diện trước khi worker gửi.

Tự sinh khóa trên máy của bạn bằng `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"`, dán trực tiếp vào Render, không commit/in log khóa. Giữ bản sao bảo mật; không tự thay khóa này khi redeploy vì dữ liệu outbox cũ cần giải mã.

Nếu bật Push: thêm VAPID public/private và subject theo [hướng dẫn SMTP/VAPID](./VC06_SMTP_VAPID.md), đặt `WEB_PUSH_ENABLED=true`, giữ cùng khóa mã hóa và kiểm trên thiết bị đã cấp quyền. ZNS tiếp tục tắt.

## 6. Kiểm sau deploy và bàn giao

- [ ] Đối chiếu SHA deploy Vercel/Render trùng commit main đã xanh CI; health `/api/v1/health` trả 200, `/api/docs` và `/api/docs-json` không mở ở production.
- [ ] Refresh trực tiếp route ADMIN/UNIT, đăng nhập/đổi mật khẩu/làm mới phiên; kiểm desktop và mobile 390 px, bảng cuộn và nút tài khoản trong header.
- [ ] Kiểm lịch bổ sung cuối tuần dưới 7 ngày, tạo Excel → preview → confirm, ngưỡng tùy chỉnh/khóa sau công bố, chốt/dashboard/báo cáo khớp cấu hình và màu kỳ.
- [ ] Trong Render Shell đặt `VC10_SUPABASE_BUCKET=evidences` rồi `npm run test:supabase`: script tạo/xóa đúng object UUID kiểm, đối chiếu bytes và ACL private. Tiếp tục upload/confirm/download qua hai vai trò; UNIT khác không đọc được minh chứng.
- [ ] Tạo đúng một tài khoản với hộp thư thử do nhóm chỉ định; kiểm đúng địa chỉ trước xác nhận gửi, mở hộp thư thật (cả spam), đăng nhập bằng nội dung nhận và đổi mật khẩu. Không dùng riêng trạng thái SENT làm bằng chứng đã nhận.
- [ ] Kiểm nhắc hạn theo giờ server và Push trên thiết bị thật nếu bật; không sửa giờ máy chủ để demo.
- [ ] Tạo/tải XLSX/PDF/DOCX, redeploy hoặc restart BE rồi tải lại báo cáo đã tạo để xác nhận disk bền vững.
- [ ] Backup PostgreSQL, bucket minh chứng và disk báo cáo cùng mốc; restore vào DB/bucket/disk mới, kiểm login/quyền/hash/minh chứng/báo cáo. [Script Compose](../deploy/backup-restore.mjs) không tự backup Render hoặc Supabase.
- [ ] Ghi URL/SHA/người nhận/thiết bị/kết quả vào [biên bản](./DEMO_NGHIEM_THU.md), chạy hai lần diễn tập bảo vệ. Phần chưa có bằng chứng tiếp tục để mở.

## 7. Tra lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| Không kết nối API, CORS | FE API origin không có `/api/v1`; redeploy FE sau đổi biến; WEB_ORIGINS chính xác, không còn CORS_ORIGINS cũ |
| BE không khởi động | Log chỉ tên biến thiếu; NODE_ENV production, Swagger false, khóa ngẫu nhiên, schema đã migrate và role runtime có quyền |
| Build thiếu tsc/Prisma | Đúng Root Directory `be`, dùng `npm ci --include=dev`, generate trước build |
| Rate limit cho nhiều tài khoản | Đang dùng IP peer proxy chung; xác minh mạng proxy trước cấu hình CIDR, không dùng TRUST_PROXY=true |
| Email timeout | Gói Render có chặn SMTP không, port/TLS, xác thực, MAIL_FROM, khóa AES và trạng thái kênh/recipient đã xác nhận |
| Báo cáo cũ mất sau deploy | Disk mount `/var/data` và REPORT_EXPORT_DIR phải nằm trong mount; metadata DB không thay bytes bị mất |
| Supabase 503 từ ứng dụng | Bucket private/tên chính xác, server key đúng project, outbound/network; không chuyển bucket public để sửa lỗi |

Nguồn hosting được đối chiếu tài liệu chính thức ngày 25/11/2026. Cấu hình trong repo không chứng minh đã tạo tài nguyên, gửi Email/Push hoặc kiểm bucket thật.
