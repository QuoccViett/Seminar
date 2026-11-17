# VC06 — cấu hình Email, Web Push và kiểm gửi có kiểm soát

Tài liệu này dùng với [API contract](./API_CONTRACT.md) và [cấu hình mẫu backend](../be/.env.example)  Phần Zalo ZNS chỉ chuẩn bị cấu hình, giữ `ZALO_ZNS_ENABLED=false` vì chưa có provider gửi và vì ZNS có phí

## 1  Tạo bí mật ở máy chạy backend

Trong `be/`, chạy PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node --input-type=module -e "import webpush from 'web-push'; console.log(webpush.generateVAPIDKeys())"
```

Lệnh đầu tạo `CREDENTIALS_ENCRYPTION_KEY` 32 byte base64  Lệnh sau tạo cặp `WEB_PUSH_VAPID_PUBLIC_KEY` và `WEB_PUSH_VAPID_PRIVATE_KEY`  Giữ cùng một cặp VAPID khi khởi động lại; thay khóa VAPID có thể làm subscription cũ hết hiệu lực  Giữ khóa riêng và khóa mã hóa trong `be/.env` hoặc kho bí mật của môi trường, không đưa lên Git  `be/.env` đã được `.gitignore` loại trừ; chỉ public key được API trả cho FE

## 2  SMTP cục bộ bằng Mailpit

Mailpit nhận SMTP thật trên máy nhưng giữ thư trong hộp thử, không chuyển đến email bên ngoài  Chạy một lần:

```powershell
docker run -d --name vc06-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit:latest
```

Đặt các dòng sau trong `be/.env` cho development/test, cùng `DATABASE_URL`, `JWT_SECRET` và `WEB_ORIGINS` hợp lệ:

```dotenv
INITIAL_ACCOUNT_PASSWORD=123456
CREDENTIALS_ENCRYPTION_KEY=<khóa base64 32 byte vừa tạo>
PUBLIC_APP_URL=http://localhost:5173
EMAIL_ENABLED=true
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_AUTH_REQUIRED=false
SMTP_ALLOW_INSECURE_LOCAL=true
MAIL_FROM=demo@example.invalid
WEB_PUSH_ENABLED=false
ZALO_ZNS_ENABLED=false
```

Mở `http://localhost:8025` để xem thư thử  SMTP không mã hóa chỉ được phép tới loopback với cờ riêng ở development/test; backend từ chối cấu hình tương tự trong production  Nguồn: [hướng dẫn gửi bằng SMTP của Mailpit](https://mailpit.axllent.org/docs/usage/sending-messages/)

## 3  SMTP thật tới địa chỉ demo đã chỉ định

Chỉ dùng một tài khoản thử có email `viett061205@gmail.com` và chỉ xác nhận/gửi một lượt credential  Nếu dùng Gmail làm tài khoản gửi, bật xác minh hai bước, tạo App Password cho ứng dụng và cấu hình:

```dotenv
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_AUTH_REQUIRED=true
SMTP_USER=<địa chỉ Gmail gửi>
SMTP_PASSWORD=<App Password, không dùng mật khẩu đăng nhập Gmail>
MAIL_FROM=<cùng địa chỉ Gmail gửi>
SMTP_ALLOW_INSECURE_LOCAL=false
CREDENTIALS_ENCRYPTION_KEY=<khóa base64 32 byte>
PUBLIC_APP_URL=<origin HTTPS của FE hoặc http://localhost:5173 khi demo cùng máy>
```

Port 465 dùng TLS ngay; nếu nhà cung cấp dùng port 587, backend yêu cầu STARTTLS và giới hạn timeout 8 giây  App Password có thể không khả dụng cho một số loại tài khoản; dùng SMTP do tổ chức cấp khi đó  Không dán App Password vào chat, commit hoặc ảnh chụp  Nguồn: [Nodemailer SMTP](https://nodemailer.com/smtp/), [Google App Password](https://support.google.com/accounts/answer/185833)

Backend cũng nhận các tên biến tương thích `SMTP_PASS` và `SMTP_FROM`, nhưng cấu hình mới nên dùng `SMTP_PASSWORD` và `MAIL_FROM` để thống nhất với contract  Khi bật Email phải đặt `EMAIL_ENABLED=true` và giữ `CREDENTIALS_ENCRYPTION_KEY` trong secret store

Sau khi bật cấu hình, khởi động lại backend  Admin tạo một tài khoản thử với email đúng địa chỉ demo, kiểm tra địa chỉ ngoài hệ thống, rồi bấm **Xác nhận email** trên màn quản lý tài khoản  Chờ worker xử lý, bấm **Trạng thái gửi**; `SENT` nghĩa SMTP đã tiếp nhận thư, không xác nhận người dùng đã mở thư  Nếu tài khoản được tạo trước lúc có khóa mã hóa, cần đặt lại mật khẩu sau khi cấu hình vì backend chỉ còn hash của mật khẩu cũ  Không bấm xác nhận/reset lặp để tránh gửi nhiều thư

## 4  Bật Web Push

Thêm vào `be/.env`:

```dotenv
WEB_PUSH_ENABLED=true
WEB_PUSH_VAPID_PUBLIC_KEY=<publicKey đã tạo>
WEB_PUSH_VAPID_PRIVATE_KEY=<privateKey cùng cặp>
WEB_PUSH_SUBJECT=mailto:<email liên hệ hợp lệ>
WEB_PUSH_ALLOWED_HOSTS=fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com,wns2-pn1p.notify.windows.com
CREDENTIALS_ENCRYPTION_KEY=<khóa base64 32 byte>
PUBLIC_APP_URL=http://localhost:5173
```

FE tự lấy public key từ `GET /api/v1/notifications/web-push/public-key`, không cần `VITE_WEB_PUSH_VAPID_PUBLIC_KEY`  Dùng HTTPS hoặc `localhost` để trình duyệt cho phép service worker/Push API  Với tài khoản đã đổi mật khẩu, mở hộp thư và bấm **Đăng ký thiết bị này**, sau đó bấm **Thử kênh** một lần  Với tài khoản mới, Email được Admin xác nhận sẽ chứa link mời có token trong fragment; chỉ người nhận mở link trên thiết bị của mình, bấm đăng ký rồi mới đăng nhập/đổi mật khẩu  Token chỉ dùng một lần và hết hạn sau 48 giờ; Web Push chưa có subscription giữ trạng thái `PENDING/NO_SUBSCRIPTION` cho đến TTL  Push `SENT` nghĩa push service đã tiếp nhận, không xác nhận thông báo đã hiển thị hay được đọc

Endpoint Web Push chỉ nhận các host được khai báo trong allowlist  Nếu trình duyệt trả host khác, xác minh đó là push service chính thức của trình duyệt rồi mới thêm host, không thêm wildcard hoặc địa chỉ nội bộ  Nguồn: [web-push README](https://github.com/web-push-libs/web-push/blob/master/README.md), [MDN Push API và secure context](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/push_event)

## 5  Kiểm trạng thái và giới hạn

`GET /api/v1/users/:id/credential-deliveries` dành cho Admin trả trạng thái từng kênh và `allRequiredChannelsSent`  `GET /api/v1/notifications/:id/deliveries` trả trạng thái thông báo thường cho chính người nhận  FE cũng có nút xem trạng thái tương ứng  `credentialsSentAt` chỉ xác nhận ít nhất một provider đã nhận request  ZNS hiện luôn là **Chưa kích hoạt**, không yêu cầu secret/template hay phát sinh request gửi  Không dùng migration trên DB dùng chung chỉ để demo; thử trước trên DB PostgreSQL riêng

## 6  Chuẩn bị Zalo cho doanh nghiệp

Giữ `ZALO_ZNS_ENABLED=false` trong đồ án  Khi doanh nghiệp quyết định dùng dịch vụ có phí, cần đối chiếu tài liệu Zalo chính thức tại thời điểm tích hợp, xác định OA, App ID, quyền gửi, Access/Refresh Token, mẫu được duyệt, tài khoản/người nhận thử và chi phí trước khi viết provider và bật cờ  Các biến `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_ID`, `ZALO_TEMPLATE_MAP` hiện chỉ là chỗ chuẩn bị cấu hình; ứng dụng chủ động từ chối khởi động với cờ ZNS bật để không tạo trạng thái gửi giả  Tài liệu Zalo nêu ứng dụng phải được OA liên kết và cấp quyền qua Access Token; mẫu thông báo phải được kiểm duyệt trước khi gửi  Xem [ủy quyền ứng dụng với OA](https://stc-developers.zdn.vn/docs/v2/official-account/bat-dau/xac-thuc-va-uy-quyen-cho-ung-dung-new) và [quản lý mẫu ZNS](https://stc-developers.zdn.vn/docs/v2/zalo-notification-service/quan-ly-tai-san/tao-template)
