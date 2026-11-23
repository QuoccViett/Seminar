# API Contract — Hệ thống đánh giá thi đua Đoàn

Tài liệu này chuyển đặc tả ở [danh sách api.md](./danh%20s%C3%A1ch%20api.md) thành các hợp đồng request/response mẫu để frontend và backend phát triển song song.

> **Quy ước tên field:** Request/response API dùng `camelCase` nhất quán. Tên cột PostgreSQL có thể tiếp tục dùng `snake_case`; Prisma ánh xạ giữa field code và cột DB.

## 1. Quy ước chung

- Request có body gửi `Content-Type: application/json`; upload trực tiếp dùng HTTP method và headers do signed URL trả về.
- Endpoint cần đăng nhập gửi `Authorization: Bearer <accessToken>`.
- Không nhận identity/phân quyền do client tự khai báo. Không trả `passwordHash`, `tokenHash`, access token của người khác, private key hoặc storage credentials.
- Giá trị do hệ thống quyết định như `actorId`, `createdById`, `reviewedById`, `unitId` của người UNIT, trạng thái chuyển tiếp và thời gian xử lý phải lấy từ token/quy tắc backend.

### Danh tính hiện tại

Sau khi xác thực access token, backend cung cấp cho các controller một danh tính tương đương:

```ts
type CurrentUser = {
  id: string;
  role: "ADMIN" | "UNIT";
  unitId: string | null;
};
```

- `UNIT`: `unitId` là đơn vị duy nhất của tài khoản; mọi truy vấn hồ sơ phải giới hạn theo đơn vị này.
- `ADMIN`: `unitId` là `null`; quyền quản trị vẫn phải được kiểm tra server-side.
- Đây là kiểu nội bộ backend, không phải object client được phép gửi để tự nhận quyền.

### Phân trang danh sách

VC16 giữ nguyên endpoint, schema và quyền backend hiện tại, không thêm quyền tải biên bản cho UNIT
Frontend giữ nguyên object phân trang `{ items, page, pageSize, total }`; chỉ giải envelope `data` khi không có metadata phân trang ở cấp ngoài, trường hợp `{ data: [], meta: { page, pageSize, total } }` được chuyển thành object danh sách mà không mất metadata
Request JSON thông thường và xoay vòng phiên chờ tối đa 30 giây để hỗ trợ kết nối chậm; lỗi quá hạn hiển thị tiếng Việt và giữ nháp, thời gian chờ không thay quyền hoặc deadline của backend
HTTP Web Push dùng cùng adapter xác thực/lỗi của frontend; public key và lời mời onboarding dùng `authMode=public`, không gắn Bearer của phiên đang mở và lỗi lời mời không đăng xuất phiên đó; API browser service worker/PushManager và truyền bytes capability vẫn dùng cơ chế riêng phù hợp
Upload capability không gắn JWT nghiệp vụ: lỗi từ origin backend được chuẩn hóa chung, lỗi từ origin provider ngoài chỉ dùng câu Việt cố định và không phản chiếu payload nhà cung cấp
Lỗi frontend giữ `status`, `code`, `message`, `fieldErrors` tương ứng `details`; mọi câu không hợp lệ được thay bằng tiếng Việt an toàn, không hiển thị raw SQL/provider hoặc đối tượng Axios
`403 PASSWORD_CHANGE_REQUIRED` chuyển về đổi mật khẩu, `401` chỉ thử xoay vòng một lần rồi yêu cầu đăng nhập lại, các `403` khác hiển thị đúng lỗi quyền tại thao tác
Kỳ đang chọn dùng `periodId` trên URL và bộ nhớ phiên; URL được ưu tiên, lựa chọn không tồn tại được thay bằng kỳ API cho phép xem, backend luôn kiểm lại UUID và phạm vi
Nháp điểm/diễn giải chỉ giữ trong bộ nhớ theo phiên người dùng và hồ sơ khi chuyển trang; không cache cây tiêu chí/quyền/điểm Admin, xóa nháp khi đăng xuất, đổi mật khẩu hoặc mất phiên và cảnh báo trước khi đóng trang có nháp
Countdown dùng `serverTime` và thời gian trôi đơn điệu, tại mốc mở/hết hạn hoặc khi quay lại tab phải tải lại API; countdown không cấp quyền lưu/nộp

Query params: `page` mặc định `1`; `pageSize` mặc định `20`, tối đa `100`.

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0
}
```

### Lỗi

Tất cả lỗi API dùng cấu trúc thống nhất:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Dữ liệu gửi lên không hợp lệ",
  "details": [
    {
      "field": "selfScore",
      "messages": ["Điểm phải nằm trong khoảng cho phép."]
    }
  ]
}
```

`details` luôn là mảng, kể cả khi không có lỗi trường. Mỗi phần tử có `field` và `messages` là mảng câu tiếng Việt. Trường ngoài DTO bị từ chối; đường dẫn trường lồng nhau gồm cả chỉ số mảng. Lỗi cú pháp JSON, upload và giới hạn kích thước giữ mã HTTP phù hợp và không trả thông tin thô từ cơ sở dữ liệu hay dịch vụ bên ngoài. FE dựa vào `code`/`field`, không dựa vào nội dung câu tiếng Việt để điều khiển logic.

Giá trị Decimal trong JSON được làm tròn hai chữ số thập phân; BigInt trong khoảng số nguyên an toàn được trả thành number, ngoài khoảng đó trả thành chuỗi thập phân để giữ chính xác. Thời gian được trả ở định dạng ISO UTC.

| HTTP | Dùng khi |
|---|---|
| `400` | Thiếu/sai định dạng field hoặc query. |
| `401` | Chưa đăng nhập, access token sai/hết hạn. |
| `403` | Đã đăng nhập nhưng không có quyền. |
| `404` | Không tìm thấy tài nguyên hoặc tài nguyên ngoài phạm vi được phép xem. |
| `409` | Trùng dữ liệu hoặc xung đột trạng thái hiện tại. |
| `422` | Request đúng cấu trúc nhưng vi phạm điều kiện nghiệp vụ. |
| `500` | Lỗi không dự kiến; không trả stack trace/secret. |

## 2. Xác thực, tài khoản và đơn vị

### Đăng nhập

`POST /auth/login` — public.

Request:

```json
{
  "username": "coso01",
  "password": "example-password"
}
```

`200 OK`:

```json
{
  "accessToken": "<access-token>",
  "refreshToken": "<refresh-token>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "coso01",
    "fullName": "Cơ sở demo 01",
    "role": "UNIT",
    "unitId": "22222222-2222-4222-8222-222222222222",
    "mustChangePassword": true
  }
}
```

Sai username/password trả `401` với `code = INVALID_CREDENTIALS`; không cho biết riêng username hay password sai.
Response refresh token chỉ trả cho lần đăng nhập này; backend chỉ lưu SHA-256 hash của refresh token, không lưu token thô.

### Thông tin người dùng hiện tại

`GET /auth/me` — cần access token Bearer.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "username": "coso01",
  "fullName": "Cơ sở demo 01",
  "role": "UNIT",
  "unitId": "22222222-2222-4222-8222-222222222222",
  "mustChangePassword": true
}
```

Response chỉ chứa hồ sơ an toàn của user hiện tại, không chứa password hash hoặc token.

### Làm mới access token

`POST /auth/refresh` — public; refresh token là chuỗi opaque đã được lưu hash ở backend. Refresh token cũ bị thu hồi sau khi dùng thành công.

Request:

```json
{
  "refreshToken": "<refresh-token>"
}
```

`200 OK` trả cặp access/refresh token mới cùng `tokenType`, `expiresIn` và `user` theo response đăng nhập. Token không hợp lệ, hết hạn hoặc đã dùng trả `401 INVALID_REFRESH_TOKEN`; dùng lại token đã thu hồi sẽ thu hồi mọi refresh token của tài khoản sau khi giao dịch được commit. Tài khoản còn bắt đổi mật khẩu nhận `403 PASSWORD_CHANGE_REQUIRED`.

### Đăng xuất

`POST /auth/logout` — public; thu hồi refresh token được gửi lên. Thao tác thu hồi lặp lại vẫn trả thành công để hỗ trợ logout idempotent.

Request:

```json
{
  "refreshToken": "<refresh-token>"
}
```

`200 OK`:

```json
{
  "success": true
}
```

### Đổi mật khẩu

`POST /auth/change-password` — cần access token Bearer.

Request:

```json
{
  "currentPassword": "current-password",
  "newPassword": "new-password"
}
```

Backend xác minh mật khẩu hiện tại, áp chính sách tối thiểu 8 ký tự Unicode và tối đa 72 byte UTF-8, phải có chữ và số, khác tên đăng nhập, mật khẩu cũ và mật khẩu phổ biến. Sai mật khẩu hiện tại trả `400 VALIDATION_ERROR` tại `currentPassword`; mật khẩu mới không đạt trả cùng mã tại `newPassword`. Thành công tăng phiên bản xác thực, thu hồi phiên cũ và trả cặp token mới cùng `user` theo response đăng nhập trong một giao dịch. Access token cũ hoặc thiếu phiên bản không còn hợp lệ.

> Giao ước VC02 quy định cả năm endpoint; việc nghiệm thu phụ thuộc kiểm thử backend, cơ sở dữ liệu và trình duyệt thực tế

### Các API tài khoản/đơn vị

VC04 dùng các route sau, đều cần access token và tài khoản đã đổi mật khẩu ban đầu:

| Route | Quyền | Dữ liệu vào và phản hồi |
|---|---|---|
| `GET /units` | ADMIN, UNIT | `page`, `pageSize`, `q` tìm mã/tên, `unitType`, `isActive`; UNIT chỉ nhận đơn vị của mình; trả `{items,page,pageSize,total}`; thứ tự `sortOrder,name,id` tăng dần |
| `GET /units/:id`, `GET /units/:id/users` | ADMIN, UNIT của đơn vị | Chi tiết an toàn hoặc `{items,total}`; đơn vị khác trả `404` |
| `POST /units`, `PATCH /units/:id` | ADMIN | `code`, `name`, `unitType`, `sortOrder`, `isActive` theo DTO; khóa đơn vị từ chối phiên UNIT nhưng giữ lịch sử hồ sơ |
| `GET /users` | ADMIN | `page`, `pageSize`, `q` tìm username/họ tên/email, `role`, `unitId`, `isActive`; trả `{items,page,pageSize,total}`; thứ tự `createdAt` giảm dần, `id` giảm dần |
| `GET /users/:id`, `PATCH /users/:id` | ADMIN, chính UNIT | ADMIN sửa `fullName,email,phone,role,unitId`; UNIT chỉ sửa `fullName,email,phone`; không nhận `isActive` tại route này |
| `POST /users` | ADMIN | Tạo với `username,fullName,role,unitId,email,phone`; dùng `INITIAL_ACCOUNT_PASSWORD`, bắt đổi khi đăng nhập; trả hồ sơ an toàn và `temporaryPassword` một lần, `credentialsSentAt: null` biểu thị chưa gửi |
| `PATCH /users/:id/status` | ADMIN | Body `{ "isActive": false }` hoặc `true`; khóa tài khoản thu hồi refresh và tăng `credentialVersion` để access token cũ hết hiệu lực |
| `POST /users/:id/reset-password` | ADMIN | Trả `{userId,temporaryPassword,mustChangePassword:true,credentialsSentAt:null}`; tăng phiên bản và thu hồi các phiên cũ; chưa có gửi thông tin đăng nhập ở VC04 |

VC17 kiểm cạnh tranh reset và worker credential: cả hai giữ cùng khóa dòng người dùng. Nếu reset commit trước, claim cũ không được gọi provider; nếu provider đã bắt đầu gửi khi đang giữ khóa, reset chờ lượt gửi đó kết thúc rồi tăng phiên bản và hủy payload cũ. Thư đã được provider nhận trước reset không được coi là có thể thu hồi. Giao dịch reset và công bố kỳ có ngân sách tối đa 30 giây, chờ lấy kết nối tối đa 10 giây; mọi điều kiện quyền và thời gian vẫn kiểm trên server sau khóa.

`q` được trim, tối đa 100 ký tự, chuỗi rỗng tương đương không lọc. Email được trim và chuyển chữ thường, username được trim và chuyển chữ thường lúc tạo; phone được trim, chỉ nhận 9–15 chữ số với dấu `+` đầu chuỗi tùy chọn. Username không được sửa. Mọi phản hồi hồ sơ chọn trường công khai rõ ràng, không có `passwordHash`, `credentialVersion` hoặc mật khẩu cũ. Đổi vai trò/hạ trạng thái ADMIN cuối cùng trả `422 LAST_ADMIN`; tự khóa/hạ quyền trả `422 BUSINESS_RULE_VIOLATION`; trùng mã/tên đăng nhập/email/unit trả `409`, ID không thuộc quyền xem trả `404`. Audit thay đổi cùng giao dịch và chỉ lưu các trường công khai. `temporaryPassword` chỉ phục vụ cấp tay trong VC04; trạng thái chưa gửi phải hiển thị rõ. Gửi credential qua các kênh thuộc VC06/VC07.

### Hộp thư và hàng đợi thông báo VC05

Các route dưới đây cần Bearer access token đã đổi mật khẩu ban đầu, chỉ dùng `userId` từ token đã kiểm tra ở backend. `SYSTEM` là bản ghi hộp thư luôn bật; ba tùy chọn gửi ngoài là `WEB_PUSH`, `EMAIL`, `ZALO_ZNS`. `ZALO_ZNS` mặc định tắt ở cấu hình hệ thống. `TELEGRAM` trong schema cũ không được API mới nhận. Kết quả tiếp nhận thông báo không xác nhận đã gửi qua provider.

| Route | Đầu vào | Phản hồi |
|---|---|---|
| `GET /notifications` | `page` (mặc định 1), `pageSize` (mặc định 20, tối đa 100), `isRead=true\|false` tùy chọn | `{items,page,pageSize,total}` sắp `createdAt,id` giảm dần; mỗi item có `id,type,title,body,refType,refId,isRead,createdAt` |
| `GET /notifications/unread-count` | Không có | `{count}` |
| `PATCH /notifications/:notificationId/read` | UUID trong path | `{isRead:true}`; thông báo không thuộc mình trả `404 NOT_FOUND` |
| `POST /notifications/read-all` | Không có | `{updated}` là số bản ghi vừa chuyển sang đã đọc |
| `GET /notifications/preferences` | Không có | `{SYSTEM:true,WEB_PUSH:boolean,EMAIL:boolean,ZALO_ZNS:boolean,zaloZnsAvailable:boolean}`; không có dòng preference nghĩa là bật với Email/Push |
| `PATCH /notifications/preferences` | Một hoặc nhiều trường boolean `WEB_PUSH`, `EMAIL`, `ZALO_ZNS`; từ chối `SYSTEM` và trường lạ | Cùng shape GET; bật ZNS khi hệ thống tắt trả `400 VALIDATION_ERROR` |
| `POST /notifications/test` | `{channel:"SYSTEM"\|"WEB_PUSH"\|"EMAIL"\|"ZALO_ZNS"}` | `{notificationId,queuedChannels}`; chỉ tạo hộp thư và delivery trong DB, provider xử lý sau commit; ZNS tắt hoặc kênh cá nhân tắt trả `400 VALIDATION_ERROR` |

`notifyUser(tx, input)` là API nội bộ: caller đưa transaction Prisma đang mở, `userId,type,title,body,dedupeKey` và tham chiếu tùy chọn. Dedupe theo `(userId,dedupeKey)`; retry cùng khóa trả bản ghi cũ, không thêm delivery. Rollback nghiệp vụ cũng rollback hộp thư và outbox. Không truyền password, token hoặc bí mật vào title/body. Worker chỉ nhận delivery `PENDING` đã đến hạn, dùng `FOR UPDATE SKIP LOCKED`, lease và `claimToken` để chặn worker cũ hoàn tất việc của worker mới. Kết quả `SENT/FAILED/SKIPPED` và `reasonCode/lastError` tiếng Việt được lưu theo từng kênh, không trả lỗi provider thô. `FAILED` chỉ sau tối đa năm lần thử; lỗi vĩnh viễn chuyển `SKIPPED`. Provider Email/Push và kiểm gửi thật thuộc VC06; VC05 dùng provider giả trong test và provider chưa cấu hình được đánh dấu `SKIPPED`.

### Cấu hình Email/Web Push/Zalo ZNS VC06

Email chỉ khởi động khi `EMAIL_ENABLED=true` và SMTP host/port, `MAIL_FROM`, thông tin xác thực nếu bật `SMTP_AUTH_REQUIRED` hợp lệ; Web Push chỉ chạy khi `WEB_PUSH_ENABLED=true` và đủ VAPID public/private key cùng subject. Khi cờ tắt, provider không gọi dịch vụ ngoài và delivery thông báo thường được đánh dấu `SKIPPED` với mã thiếu người nhận/cấu hình tương ứng; lỗi SMTP tạm thời được retry qua worker, còn endpoint Web Push trả 404/410 sẽ bị thu hồi. Secret chỉ lấy từ cấu hình tiến trình, không trả qua API hoặc ghi log. `ZALO_ZNS_ENABLED` mặc định `false`; VC06 chỉ giữ cấu hình ZNS, chưa có provider gửi và cấu hình bật sẽ bị từ chối lúc khởi động để không tạo việc gửi giả. Email/Web Push có provider gửi cho thông báo thường và cho credential theo điều kiện xác nhận bên dưới.

Để tương thích cấu hình Gmail đang dùng, backend cũng nhận `SMTP_PASS` như bí danh của `SMTP_PASSWORD` và `SMTP_FROM` như bí danh của `MAIL_FROM`; cấu hình mới nên dùng tên canonical. Khi Email hoặc Web Push bật, `CREDENTIALS_ENCRYPTION_KEY` là bắt buộc

VC06 bổ sung các route sau. Mọi route có `userId` chỉ ADMIN dùng được; các route subscription Bearer luôn gắn với chính tài khoản trong token. `GET /notifications/web-push/public-key` công khai, trả `{enabled,publicKey}` với `publicKey:null` khi tắt. `POST /notifications/web-push/subscriptions` nhận `{endpoint,keys:{p256dh,auth},expirationTime?}` và trả `{registered:true}`; endpoint thuộc tài khoản khác trả `409 SUBSCRIPTION_OWNED`. `DELETE /notifications/web-push/subscriptions/current` nhận `{endpoint}` và trả `{revoked:true}`, chỉ thu hồi thiết bị của chính mình. Khi chưa đổi mật khẩu, người nhận mở link mời có token ở URL fragment, gọi `POST /onboarding/web-push/verify` với `{token}` và `POST /onboarding/web-push/subscriptions` với `{token,subscription}`; token 48 byte chỉ dùng một lần, hết hạn, gắn phiên bản credential và chỉ có quyền đăng ký Push. Không route nào cho token mời truy cập nghiệp vụ khác.

Khi có `CREDENTIALS_ENCRYPTION_KEY` 32 byte dạng base64, tạo/reset user lưu một `CredentialDispatch` mã hóa AES-256-GCM cùng transaction; không đưa mật khẩu vào Notification, audit hoặc GET. Khóa này bắt buộc khi Email hoặc Web Push được bật. Admin xác nhận địa chỉ đã kiểm tra bằng `POST /users/:id/credential-deliveries/confirm-email` với `{email}` khớp email tài khoản hiện tại trước khi worker gửi; không có xác nhận thì Email ở trạng thái `PENDING` với `EMAIL_UNCONFIRMED`. `GET /users/:id/credential-deliveries` trả `{credentialsSentAt,allRequiredChannelsSent,channels:[{channel,status,errorCode,attemptCount,sentAt}],expiresAt,status,zaloZnsAvailable}`; không có ciphertext/token/password/email trong phản hồi. Web Push chưa có thiết bị giữ `PENDING/NO_SUBSCRIPTION` đến TTL, không báo SENT. Đổi/reset mật khẩu làm vô hiệu hóa dispatch cũ, xóa ciphertext; việc đang gửi được đồng bộ với thay đổi phiên bản. Thiếu khóa mã hóa khi mọi kênh gửi tắt thì tạo/reset vẫn hoạt động theo hợp đồng VC04 và trạng thái gửi tự động là `NOT_CONFIGURED`; cần reset lại sau khi cấu hình để tạo payload gửi, không thể tái tạo mật khẩu rõ từ hash.

`allRequiredChannelsSent` chỉ là `true` khi dispatch có ít nhất một delivery bắt buộc và mọi delivery đều `SENT`; không có delivery trả `false` để phân biệt chưa cấu hình hoặc chưa xếp hàng với đã gửi thành công

### Import Excel tài khoản UNIT VC07

Bốn route dưới đây yêu cầu Bearer đã đổi mật khẩu ban đầu và chỉ ADMIN được gọi. Tệp mẫu chỉ có một sheet, hàng đầu là tiêu đề `unitCode,unitName,unitType,username,fullName,email,phone`; `unitType` nhận `CONG_AN_QUAN_HUYEN`, `PHONG_NGHIEP_VU` hoặc `DON_VI_TRUC_THUOC`; `phone` được ghi dạng văn bản để giữ số 0 đầu. Mọi dòng tạo tài khoản UNIT, không nhận `role`, `password`, `isActive` hoặc `unitId` từ file. Email bắt buộc để có địa chỉ nhận credential; số điện thoại chỉ được lưu hồ sơ, không tự gửi ZNS.

| Route | Đầu vào | Phản hồi |
|---|---|---|
| `GET /users/import/template` | Không có | Tệp XLSX tải xuống, header `Content-Disposition` là `attachment` |
| `POST /users/import/preview` | `multipart/form-data`, field `file` là `.xlsx`, header `Idempotency-Key` dài 1–200 ký tự | `{importId,expiresAt,totalRows,validRows,invalidRows,rows:[{rowNumber,unitCode,unitName,unitType,username,fullName,email,phone,errors:[{field,code,message}]}]}`; lỗi dùng mã ổn định như `DUPLICATE_USERNAME`, `UNIT_MISMATCH`, `INVALID_EMAIL`; tối đa 5 MiB, 100 dòng dữ liệu, 1 sheet và 25 MiB sau giải nén |
| `POST /users/import/:importId/confirm` | UUID phiên trong path; body `{}` | `{importId,status:"CONFIRMED",createdCount,unitsCreated,accounts:[{rowNumber,userId,username,email,unitCode,credentialStatus,channels}]}`; mỗi channel có `{channel,status,errorCode,attemptCount,sentAt}` |
| `POST /users/:id/credential-deliveries/retry` | ADMIN; body `{channel:"EMAIL"|"WEB_PUSH"}` | `{userId,channel,status:"PENDING"}`; chỉ nhận delivery lỗi còn hạn và còn payload mã hóa, không gọi provider trong request |

Preview chỉ đọc file, lưu digest SHA-256 và các dòng đã chuẩn hóa/lỗi trong `ImportSession` gắn Admin, TTL 30 phút; không ghi Unit/User, password, file bytes hoặc provider payload. Gửi lại preview cùng `Idempotency-Key` và cùng digest trả lại phiên cũ; cùng khóa nhưng digest khác trả `409 IDEMPOTENCY_KEY_REUSED`. Từ chối tệp sai chữ ký/ZIP hỏng, mã hóa, macro, công thức, sheet thừa, tiêu đề sai, dòng trống toàn bộ bị bỏ qua, giá trị vượt giới hạn và file vượt giới hạn trước khi lưu phiên.

Confirm khóa phiên và kiểm lại hạn, lỗi preview, Unit/User/email trùng trong cơ sở dữ liệu dưới một transaction. Chỉ liên kết Unit có mã trùng khi tên/loại khớp chính xác, đang hoạt động và chưa có tài khoản; nếu chưa có thì tạo mới, không sửa dữ liệu sẵn có. Một lỗi bất kỳ trả `422 IMPORT_VALIDATION_FAILED` kèm lỗi theo dòng và rollback toàn bộ. Session hết hạn trả `422 IMPORT_SESSION_EXPIRED`; phiên của Admin khác trả `404 IMPORT_SESSION_NOT_FOUND`. Gọi lại phiên đã xác nhận trả đúng `result` đã lưu, không tạo thêm tài khoản hoặc delivery. Username chuẩn hóa chữ thường, email chuẩn hóa chữ thường; phone lưu dạng chuỗi đã chuẩn hóa.

Mật khẩu ban đầu lấy từ `INITIAL_ACCOUNT_PASSWORD`, mặc định demo `123456`, chỉ lưu hash User; `mustChangePassword=true`, `credentialVersion=0`. Dispatch mã hóa và delivery Web Push/Email được xếp trong cùng transaction qua dịch vụ VC06 khi có khóa/cấu hình; gửi mạng do worker thực hiện sau commit, Email vẫn cần Admin xác nhận địa chỉ, Web Push cần đăng ký thiết bị và ZNS luôn báo chưa kích hoạt. Khi thiếu khóa mã hóa trả `credentialStatus:"NOT_CONFIGURED"`; Admin cần cấu hình khóa rồi cấp lại thông tin đăng nhập qua luồng reset hiện có. Confirm không trả mật khẩu tạm và không báo gửi thành công trước khi provider tiếp nhận. Admin có thể xác nhận email từng người nhận bằng route VC06 rồi dùng route retry cho kênh lỗi còn đủ điều kiện; dữ liệu mã hóa được giữ tới TTL khi delivery thất bại để việc retry không cần tái tạo mật khẩu rõ.

`GET /notifications/:notificationId/deliveries` cần Bearer của chủ thông báo, trả `{notificationId,channels:[{channel,status,reasonCode,lastError,attemptCount,sentAt}]}`. Không có delivery ngoài khi thông báo chỉ ở hộp thư SYSTEM. `SENT` ở cả hai loại delivery nghĩa provider đã tiếp nhận request, chưa xác nhận người nhận đã xem. [Hướng dẫn cấu hình SMTP/VAPID](./VC06_SMTP_VAPID.md) ghi rõ môi trường thử cục bộ và cách bật thực tế.

## 3. Đợt thi đua, ngưỡng và tiêu chí

### Tạo đợt

`POST /evaluation-periods` — ADMIN.

Request:

```json
{
  "year": 2026,
  "name": "Thi đua Công tác Đoàn năm 2026",
  "maxTotalScore": 300,
  "selfEvalStart": "2026-10-01T00:00:00.000Z",
  "selfEvalDeadline": "2026-10-31T16:59:00.000Z"
}
```

Backend lấy `createdById` từ CurrentUser, phase ban đầu là `SETUP`; client không được gửi phase, `publishedAt` hoặc `finalizedAt`.
Lịch tự chấm nhận mọi ngày/giờ và được backend so sánh theo UTC tại từng request. Giá trị ISO phải có `Z` hoặc độ lệch UTC tường minh; API không diễn giải chuỗi giờ địa phương không có múi giờ. Trường DB legacy `supplementHours` không được nhận hoặc dùng để tính hạn bổ sung; lịch bổ sung tạm mục 1.4/5.4 vẫn chờ xác nhận và thuộc luồng sau.

`PATCH /evaluation-periods/:id` — ADMIN cập nhật kỳ khi kỳ chưa mở. Nếu kỳ đã công bố mà giờ mở chưa tới, thay đổi lịch phải kèm `changeReason` không rỗng; backend ghi audit trước/sau. Sau khi đã tới `selfEvalStart`, backend khóa thay đổi cấu hình. Thời gian bắt đầu phải nhỏ hơn thời hạn.

`PUT /evaluation-periods/:id/thresholds` — ADMIN thay toàn bộ bốn ngưỡng trước công bố. Body có đúng một EXCELLENT/GOOD/PASS/FAIL; mặc định 85/65/50/0, cho chỉnh cận với FAIL=0 < PASS < GOOD < EXCELLENT <100, chỉ EXCELLENT loại trừ. Cấu hình sai thứ tự hoặc kỳ đã công bố bị từ chối. Việc thay bộ ngưỡng là nguyên tử và được audit.

`GET /evaluation-periods/:id/thresholds` — ADMIN đọc cấu hình nháp; UNIT chỉ nhận bộ ngưỡng khi kỳ đã công bố và đã tới giờ mở.

`GET /evaluation-periods/:id/publish-check` — ADMIN nhận `{periodId,canPublish,checks:[{code,passed,message}]}`. Kiểm tra lịch, điểm tối đa tổng các tiêu chí lá, điểm tổng của từng nhóm, hình thức minh chứng từng tiêu chí lá, đủ bốn ngưỡng và có đơn vị hoạt động. Các điều kiện sai trả thông điệp tiếng Việt có mã trường ổn định.

`POST /evaluation-periods/:id/publish` — ADMIN công bố kỳ đã vượt publish-check. Backend tự cấp `publishedAt`, phase và audit; trong cùng transaction tạo một hồ sơ DRAFT cho mỗi đơn vị hoạt động, điểm rỗng cho từng tiêu chí lá và hộp thư SYSTEM chống trùng, không xếp hàng gửi kênh ngoài. Không nhận dấu thời gian công bố từ client. Gọi lặp không tạo hồ sơ trùng. Có thể công bố trước ngày mở để UNIT được thấy cấu hình đúng tại `selfEvalStart`.

`DELETE /evaluation-periods/:id` — ADMIN chỉ xóa kỳ nháp chưa có hồ sơ hoặc báo cáo; kỳ đã công bố bị từ chối. Kiểm tra và audit thao tác được thực hiện cùng transaction sau khi khóa kỳ.

Các GET kỳ của ADMIN trả thêm `serverTime` và `canEditConfiguration`; cờ chỉnh sửa chỉ bật khi còn nháp hoặc kỳ đã công bố vẫn ở SETUP, chưa tới giờ mở. UNIT dùng `selfEvalState=CLOSED` ở mọi phase review/đóng dù lịch bị sửa ngoài API. Publish-check thêm `notExpired` để từ chối công bố khi đã đến deadline.

`GET /evaluation-periods/:id/phase-options` — ADMIN nhận `{periodId,phase,serverTime,options:[{phase,allowed,message}]}` từ điều kiện hiện tại của backend, không lấy quyền từ giờ máy FE.

`POST /evaluation-periods/:id/transition-phase` — ADMIN gửi `{phase}` với một trong `SELF_EVAL`, `FIRST_REVIEW`, `SUPPLEMENT`, `FINAL_REVIEW`, `CLOSED`. Chỉ chuyển theo đồ thị SETUP → SELF_EVAL → FIRST_REVIEW → SUPPLEMENT → FINAL_REVIEW → CLOSED, cho phép FIRST_REVIEW → FINAL_REVIEW khi không có vòng bổ sung đang mở và SETUP → FIRST_REVIEW khi bỏ lỡ toàn bộ cửa sổ tự chấm. Không chuyển lùi/mở lại/lặp hoặc chuyển kỳ chưa công bố. SELF_EVAL cần `start <= now < deadline`; FIRST_REVIEW cần đến deadline và tự khóa các hồ sơ DRAFT thành PENDING_REVIEW (không bắt đủ minh chứng). SUPPLEMENT cần có hồ sơ đã thẩm định lần đầu với snapshot bổ sung còn hiệu lực. FINAL_REVIEW cần mọi hồ sơ đã thẩm định lần đầu, không còn bổ sung đang mở; các yêu cầu đã hết hạn được reconcile thành SUPPLEMENT_EXPIRED trong cùng transaction. CLOSED cần mọi hồ sơ FINALIZED có đủ kết quả chốt, backend cấp finalizedAt. Khóa kỳ rồi khóa hồ sơ theo thứ tự ID, kiểm lại giờ sau khi lấy khóa, audit/history/hộp thư SYSTEM cùng transaction; không xếp delivery ngoài. Điều kiện không đạt trả `400 BUSINESS_RULE_VIOLATION`, payload sai `400 VALIDATION_ERROR`, không tồn tại `404 NOT_FOUND`. Service được export để các use-case VC09/VC11/VC12 dùng chung; endpoint này không thay thế nhập điểm/upload/thẩm định/chốt điểm từng hồ sơ.

`POST /evaluation-periods/supplement-schedule/preview` — ADMIN gửi `{supplementStartAt,supplementDeadline}`; cả hai là ISO có offset/Z và `start < deadline`. Nhận `{supplementStartAt,supplementDeadline,serverTime,policy:"ADMIN_DEFINED",displayUntil,notice}` với hai mốc UTC giữ nguyên instant đã chọn. Chấp nhận mọi ngày/giờ, gồm thứ Bảy/Chủ nhật, qua tháng/năm và khoảng ngắn hơn bảy ngày; không tự dời ngày hoặc tính lại từ `supplementHours`. Preview không ghi hồ sơ. Khi tạo yêu cầu thật, start không được trước giờ DB sau khóa. Cửa sổ ghi là `[start,deadline)`, đúng deadline khóa dù job trễ.

Scheduler VC11 quét các kỳ đã công bố và snapshot bổ sung đã lưu bằng giờ cơ sở dữ liệu, khóa kỳ rồi hồ sơ trong transaction và ghi audit, lịch sử, hộp thư cùng transaction. Kỳ bỏ lỡ toàn bộ cửa sổ chuyển thẳng sang thẩm định, không gửi thông báo mở muộn. Nhắc hạn được tạo từ mốc trước hạn 24 giờ cho tới trước hạn nếu mốc nằm trong cửa sổ; khóa chống trùng bao gồm hạn đã lưu, nên tiến trình chạy lại sau gián đoạn vẫn có thể tạo nhắc còn hiệu lực. Nội dung lịch ghi giờ mở và thời điểm đóng theo giờ Việt Nam. Tin mở và nhắc có hạn hiệu lực lưu cùng thông báo; worker kiểm hạn ngay trước khi gọi provider, quá hạn đánh dấu SKIPPED với mã EXPIRED. Web Push giới hạn TTL theo thời gian còn lại; email đã được SMTP nhận trước hạn vẫn có thể đến sau hạn. Quyền thao tác do backend quyết định theo thời gian, không phụ thuộc lần quét hay đồng hồ giao diện.

Scheduler và lệnh chuyển sang thẩm định cuối dùng chung xử lý hết hạn bổ sung: hồ sơ đủ điều kiện được chuyển một lần, ghi lịch sử, audit và thông báo Admin/UNIT trong cùng transaction; hồ sơ đã nộp hoặc đã chốt không bị thay đổi.

Giới hạn của provider được xử lý theo phản hồi: SMTP 452 hoặc Web Push 429 chuyển `RATE_LIMIT`, giữ delivery chờ với backoff và giới hạn số lần thử như lỗi tạm khác. Đây là xử lý khi provider báo giới hạn, chưa cấu hình hạn mức chủ động chung cho nhiều tiến trình.

`POST /admin/scheduler/run` chỉ dành cho ADMIN đã đổi mật khẩu và cấu hình `ENABLE_DEMO_TOOLS=true`, mặc định tắt; môi trường production từ chối bật. Lệnh chạy một lượt quét trạng thái và dọn token, không trực tiếp ép gửi provider, trả thông báo tiếng Việt và số kỳ lỗi. Các worker delivery và cleanup độc lập vẫn chạy theo nhịp riêng.

`GET /evaluation-periods` và `GET /evaluation-periods/:id` — ADMIN đọc cấu hình nháp. Danh sách UNIT chỉ gồm kỳ đã công bố; đọc chi tiết hoặc ngưỡng kỳ chưa công bố trả `404 NOT_FOUND`. UNIT nhận `serverTime`, `selfEvalState` (`NOT_OPEN_YET`, `OPEN`, `CLOSED`) và `criteriaVisible`; trước giờ mở, tiêu chí/ngưỡng rỗng và không trả `maxTotalScore`. Sau công bố và khi thời gian server thỏa `now >= selfEvalStart`, UNIT nhận tiêu chí/ngưỡng. `GET /evaluation-periods/:periodId/criteria` trả `404 NOT_FOUND` nếu kỳ chưa công bố, `400 NOT_OPEN_YET` trước giờ mở và cây tiêu chí từ đúng giờ mở trở đi. Nội dung được trả cả trong kỳ nghỉ/cuối tuần và ngoài giờ hành chính. Quyền này do backend tính lại theo từng request, không dựa vào phase, job hay đồng hồ trình duyệt.

`201 Created`:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "year": 2026,
  "name": "Thi đua Công tác Đoàn năm 2026",
  "phase": "SETUP",
  "maxTotalScore": 300,
  "selfEvalStart": "2026-10-01T00:00:00.000Z",
  "selfEvalDeadline": "2026-10-31T16:59:00.000Z"
}
```

### Cấu hình tiêu chí

`POST /evaluation-periods/:periodId/criteria` — ADMIN. Body không có `periodId` vì kỳ được xác định từ route.

```json
{
  "parentId": null,
  "code": "1",
  "name": "Công tác tuyên truyền",
  "description": "Nội dung đánh giá",
  "maxScore": 10,
  "evidenceRequirement": "Nộp báo cáo hoặc đường dẫn bài viết",
  "allowText": true,
  "allowFile": true,
  "allowLink": true,
  "evidenceRequired": true,
  "sortOrder": 1
}
```

Response `201 Created`: resource tiêu chí đã lưu, gồm `id`, `periodId` và các field cấu hình; `createdAt`/`updatedAt` do server cấp. `PATCH /criteria/:id` và `DELETE /criteria/:id` là route ADMIN chuẩn; backend tự tìm kỳ rồi dùng cùng use-case khóa kỳ trước sửa/xóa. Giữ `PATCH /evaluation-periods/:periodId/criteria/:id` và `DELETE /evaluation-periods/:periodId/criteria/:id` để tương thích client hiện tại; `id` phải thuộc `periodId`, nếu không trả `404 NOT_FOUND`. Cả hai dạng chỉ hoạt động trước công bố; tiêu chí cha phải cùng kỳ, điểm tối đa phải dương. Các thao tác sửa cấu hình và công bố tuần tự theo khóa kỳ; thay đổi cùng audit được lưu trong một transaction, không trả lỗi SQL/Prisma thô. Không có GET /criteria/:id để tránh thêm đường đọc chưa áp dụng projection.

## 4. Hồ sơ, điểm và minh chứng

### Giao ước VC09 — hồ sơ và tự chấm

Đã triển khai VC09, giữ NestJS/Prisma/PostgreSQL và JSON camelCase

- `GET /evaluations?periodId=&status=&page=1&pageSize=20`: ADMIN đọc mọi hồ sơ, UNIT chỉ hồ sơ đơn vị từ phiên và kỳ đã công bố; trả `{items,page,pageSize,total}` metadata, thứ tự createdAt/id giảm dần
- `POST /evaluations` body `{periodId,unitId?}`: UNIT không được gửi unitId; ADMIN bắt buộc unitId để tạo bù đơn vị hoạt động mới trong kỳ đã công bố chưa đóng, chỉ phase SETUP/SELF_EVAL và trước deadline; lần lặp trả cùng hồ sơ `200`, không tạo thêm score/history/audit
- `GET /evaluations/:evaluationId`: metadata gồm period `{id,name,selfEvalStart,selfEvalDeadline}`, unit, status, submittedAt, autoLockedAt, supplementStartAt/supplementDeadline, serverTime, criteriaVisible, canSubmit, lockedReason, deadlineWarning và criteria là cây `children`; lá có criterionId, selfScore/selfNote, canEditSelf/lockedReason/serverTime, cấu hình minh chứng và metadata minh chứng an toàn
- UNIT trước selfEvalStart chỉ nhận metadata, `criteria: []`, không score/ngưỡng/minh chứng/summary; summary endpoint trả `403 NOT_OPEN_YET` và mọi đường ghi bị chặn
- UNIT trước FINALIZED không nhận adminScore/adminComment/reviewedById/currentTotal/currentPercent hoặc tổng có điểm Admin; ADMIN được đọc `adminScore`, `adminComment`, `reviewedById`, `reviewedAt`, `supplementNote`, `supplementedAt` trên lá và `firstReviewedAt` trên metadata. Điểm Admin null biểu thị chưa duyệt, giao diện có thể hiển thị điểm tự chấm làm giá trị nhập ban đầu; UNIT sau chốt chỉ thêm `finalResult: {score,percent,rating}`
- `GET /evaluations/:evaluationId/score-summary`: `{evaluationId,selfTotal,maxTotalScore,selfPercent,suggestedRating,ratingLabel,ratingColor,scoredCount,leafCount,isFinal,finalResult?}`; null tính 0, tổng bằng Decimal, xếp loại so ngưỡng chính xác trước làm tròn hiển thị, dùng ngưỡng kỳ đã lưu; mặc định EXCELLENT >85, GOOD >=65, PASS >=50, FAIL >=0
- `PUT /evaluations/:evaluationId/scores/:criterionId/self`: UNIT chính chủ, body có ít nhất một trong selfScore (số 0..maxScore tối đa hai chữ số thập phân hoặc null để xóa), selfNote (văn bản thuần tối đa 5000 ký tự hoặc null để xóa); trường bỏ qua giữ nguyên, `{}` và trường hệ thống bị từ chối; allowText=false không nhận diễn giải có nội dung
- `PUT /evaluations/:evaluationId/scores/self-batch`: body `{items:[{criterionId,selfScore?,selfNote?}]}` từ 1..100 phần tử, không lặp criterionId; cấu trúc/nested sai trả 400 toàn request, dữ liệu nghiệp vụ sai trả `200 {results:[{criterionId,ok:true,data}|{criterionId,ok:false,error:{statusCode,code,message,details}}]}` theo thứ tự đầu vào; mỗi ô một transaction nên lỗi SQL một ô không làm mất ô khác, lỗi không nhận diện dùng INTERNAL_ERROR tiếng Việt
- Quyền ghi lá dùng giờ DB UTC đọc sau khóa kỳ → hồ sơ, kiểm lại sát ghi và trigger DB bảo vệ biên; INITIAL chỉ DRAFT trong SETUP/SELF_EVAL, đã publish, `[start,deadline)` mọi ngày/giờ; SUPPLEMENT_REQUESTED chỉ lá needsSupplement trong snapshot `[supplementStartAt,supplementDeadline)` và phase FIRST_REVIEW/SUPPLEMENT, không tính supplementHours
- `POST /evaluations/:evaluationId/submit` body `{}`: UNIT chính chủ nộp INITIAL sớm trong cửa sổ; yêu cầu mọi lá đã có điểm (0 hợp lệ), lá evidenceRequired cần ít nhất một diễn giải không trắng được allowText cho phép hoặc FILE/LINK thuộc loại được phép đã lưu; trả metadata sau chuyển PENDING_REVIEW/submittedAt, khóa sửa; nộp lặp sau nộp chủ động trả cùng metadata không thêm history/audit/outbox; không mở lại hồ sơ
- GET list/detail/summary hoặc ghi khi quá hạn reconcile DRAFT → PENDING_REVIEW ngay cả phase SETUP/job trễ, giữ submittedAt=null, đặt autoLockedAt, history actor=null/audit/outbox ADMIN cùng transaction đúng một lần; không yêu cầu đủ minh chứng; request ghi bị từ chối vẫn commit reconcile, không lưu điểm/nộp quá hạn
- Lưu điểm ghi audit before/after, submit/auto-lock ghi history/audit/hộp thư và delivery qua kiến trúc Notifications sẵn có; không gọi provider trực tiếp, ZNS theo cờ mặc định tắt
- Không đăng nhập 401, sai vai trò 403, hồ sơ khác đơn vị/kỳ nháp với UNIT 404, tiêu chí không thuộc hồ sơ 404, nhóm/điểm/nộp thiếu dữ liệu 422, cửa sổ khóa 403 SELF_EVALUATION_LOCKED; UUID/body/query sai 400 VALIDATION_ERROR tiếng Việt; không trả lỗi Prisma/SQL thô
- FE tải lại mỗi 15 giây và khi lưu/nộp, quyền/cảnh báo lấy server; có lưu thủ công, giữ nội dung chưa lưu khi refresh, chặn nộp khi đang lưu/còn chỉnh sửa, tổng từ summary API. Metadata bổ sung `canSubmitSupplement` là quyền theo lịch và trạng thái do server quyết định; backend vẫn kiểm từng mục đã thực sự thay đổi khi nộp

### Đọc hồ sơ

`GET /evaluations/:evaluationId` — ADMIN hoặc UNIT sở hữu hồ sơ.

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "periodId": "33333333-3333-4333-8333-333333333333",
  "unit": {
    "id": "22222222-2222-4222-8222-222222222222",
    "code": "COSO-DEMO-01",
    "name": "Cơ sở demo 01"
  },
  "status": "DRAFT",
  "submittedAt": null,
  "supplementDeadline": null,
  "criteria": [
    {
      "criterionId": "55555555-5555-4555-8555-555555555555",
      "code": "1.1",
      "name": "Tiêu chí mẫu",
      "maxScore": 10,
      "selfScore": null,
      "selfNote": null,
      "needsSupplement": false,
      "evidences": []
    }
  ]
}
```

UNIT chỉ nhận hồ sơ đơn vị của mình, dùng projection VC09 ở trên; các trường thẩm định chỉ dành cho ADMIN, UNIT trước mở không nhận mảng nội dung tiêu chí

### Lưu điểm tự chấm

`PUT /evaluations/:evaluationId/scores/:criterionId/self` — UNIT sở hữu hồ sơ.

Request:

```json
{
  "selfScore": 8,
  "selfNote": "Đã tổ chức hoạt động theo kế hoạch."
}
```

`200 OK`:

```json
{
  "evaluationId": "44444444-4444-4444-8444-444444444444",
  "criterionId": "55555555-5555-4555-8555-555555555555",
  "selfScore": 8,
  "selfNote": "Đã tổ chức hoạt động theo kế hoạch.",
  "updatedAt": "2026-10-17T08:30:00.000Z"
}
```

`selfScore` phải từ `0` đến `maxScore`; backend không nhận `unitId`, `adminScore`, trạng thái hoặc `reviewedById` từ UNIT.

### VC10

[Contract storage, upload và preview hiện hành](./VC10_STORAGE_CONTRACT.md)

## 5. Thẩm định, bổ sung và trạng thái

Giao ước VC12 hiện hành, quyền đọc review, baseline bổ sung, retry và chốt được mô tả đầy đủ tại [Hợp đồng VC12](./VC12_REVIEW_CONTRACT.md); khi phần mô tả cũ bên dưới thiếu chi tiết, áp dụng giao ước hiện hành này.

### Admin chấm một tiêu chí

`PUT /admin/evaluations/:evaluationId/scores/:criterionId/review` — ADMIN.

```json
{
  "adminScore": 6,
  "adminComment": "Trừ 2 điểm do minh chứng chưa thể hiện đủ nội dung."
}
```

`200 OK`:

```json
{
  "evaluationId": "44444444-4444-4444-8444-444444444444",
  "criterionId": "55555555-5555-4555-8555-555555555555",
  "adminScore": 6,
  "adminComment": "Trừ 2 điểm do minh chứng chưa thể hiện đủ nội dung.",
  "reviewedById": "33333333-3333-4333-8333-333333333333",
  "reviewedAt": "2026-10-17T08:30:00.000Z"
}
```

`adminScore` không âm, tối đa hai chữ số thập phân và không vượt điểm tối đa của lá. `adminComment` là văn bản thuần tối đa 5000 ký tự, bắt buộc không trắng khi điểm Admin khác điểm tự chấm hoặc điểm tự chấm chưa có. Chỉ chấm hồ sơ PENDING_REVIEW, SUPPLEMENT_SUBMITTED hoặc SUPPLEMENT_EXPIRED trong phase FIRST_REVIEW, SUPPLEMENT hoặc FINAL_REVIEW; hệ thống đồng bộ hết hạn bổ sung trước khi kiểm. Người duyệt và thời gian lấy từ phiên và đồng hồ cơ sở dữ liệu; audit điểm cũ, điểm mới và lý do trong cùng transaction. Cờ yêu cầu bổ sung được thiết lập bởi use-case yêu cầu bổ sung, không nhận tại endpoint này.

`POST /admin/evaluations/:evaluationId/accept-all` — ADMIN, body `{}`: chấp nhận điểm tự chấm cho các lá chưa được duyệt và có điểm tự chấm; không thay đổi lá đã có điểm Admin. Trả `{evaluationId,acceptedCount}`. Các lá chưa có điểm tự chấm phải được thẩm định riêng.

`POST /admin/evaluations/:evaluationId/first-review-complete` — ADMIN, body `{}`: chỉ trong FIRST_REVIEW hoặc SUPPLEMENT, hồ sơ PENDING_REVIEW và mọi lá đã có điểm Admin; ghi `firstReviewedAt` một lần, không chuyển giai đoạn hay chốt điểm. Gọi lại trả thời điểm đã lưu.

`POST /admin/evaluations/:evaluationId/finalize` — ADMIN, body `{}`: chỉ phase FINAL_REVIEW, hồ sơ đã hoàn tất thẩm định lần đầu và ở PENDING_REVIEW, SUPPLEMENT_SUBMITTED hoặc SUPPLEMENT_EXPIRED. Máy chủ khóa hồ sơ, lấy tổng và phân loại cùng công thức với view, lưu kết quả, lịch sử, audit và thông báo trong một transaction; yêu cầu chốt lặp trả lỗi `REVIEW_LOCKED`.

`PUT /admin/evaluations/:evaluationId/scores/review-batch` — ADMIN, body `{items:[{criterionId,adminScore,adminComment}]}` gồm 1–100 tiêu chí không trùng; trả `{results:[{criterionId,ok,data|error}]}`, mỗi mục có transaction riêng và lỗi chuẩn hóa, thứ tự giữ như đầu vào.

`POST /admin/evaluations/finalize-batch` — ADMIN, body `{evaluationIds:[uuid,...]}` gồm 1–100 hồ sơ không trùng; trả `{results:[{evaluationId,ok,data|error}]}`, mỗi hồ sơ có transaction riêng, một lỗi không hoàn tác kết quả hồ sơ khác. Client phải kiểm từng `ok`.

`POST /admin/evaluations/finalize-preview` — ADMIN, body cùng `finalize-batch`, trả kết quả dự kiến và `canFinalize` hoặc lỗi riêng từng hồ sơ. Đây chỉ là snapshot; lệnh chốt luôn khóa và kiểm lại phase, trạng thái và giờ.

### Yêu cầu bổ sung

`POST /admin/evaluations/:evaluationId/supplement-request` — ADMIN.

```json
{
  "items": [
    { "criterionId": "55555555-5555-4555-8555-555555555555", "note": "Vui lòng bổ sung minh chứng cho tiêu chí này." }
  ],
  "supplementStartAt": "2026-11-21T00:00:00.000Z",
  "supplementDeadline": "2026-11-21T01:30:00.000Z"
}
```

`200 OK`:

```json
{
  "evaluationId": "44444444-4444-4444-8444-444444444444",
  "status": "SUPPLEMENT_REQUESTED",
  "supplementStartAt": "2026-11-21T00:00:00.000Z",
  "supplementDeadline": "2026-11-21T01:30:00.000Z",
  "feedbackId": "88888888-8888-4888-8888-888888888888"
}
```

Admin chọn cả `supplementStartAt` và `supplementDeadline`; backend kiểm ISO có múi giờ, `start < deadline` và start không trước giờ DB sau khóa, rồi lưu snapshot UTC. Mọi API, job, thông báo và báo cáo đọc đúng hai mốc đã lưu, không tính từ `supplementHours`. Yêu cầu chỉ nhận hồ sơ PENDING_REVIEW đã thẩm định lần đầu và danh sách lá có ghi chú không trắng. Retry phải trùng cả start, deadline, danh sách lá và ghi chú sau trim; khác payload trả `409 SUPPLEMENT_ALREADY_REQUESTED`, không đổi lịch hoặc tạo vòng hai. `POST /evaluations/:evaluationId/supplement-submit` nhận `{}`; chỉ nộp trong `[start,deadline)` khi mọi lá yêu cầu đã thay đổi so baseline. Nộp sớm khóa sửa; sửa rồi hoàn tác không tính là bổ sung. Đúng deadline khóa mọi đường ghi và reconcile SUPPLEMENT_EXPIRED; Admin tiếp tục thẩm định/chốt theo điều kiện, không tự chốt. Reminder `deadline - 24 giờ` chỉ tạo khi mốc đó nằm trong cửa sổ.

### State machine hồ sơ

| Chuyển trạng thái | Người/tác vụ | Điều kiện chính |
|---|---|---|
| `DRAFT` → `PENDING_REVIEW` | UNIT nộp hoặc scheduler auto-lock | Đợt mở tự chấm; còn hạn khi UNIT nộp; scheduler ghi `autoLockedAt`. |
| `PENDING_REVIEW` → `SUPPLEMENT_REQUESTED` | ADMIN | Có tiêu chí được yêu cầu bổ sung và deadline do server tính. |
| `SUPPLEMENT_REQUESTED` → `SUPPLEMENT_SUBMITTED` | UNIT | Chỉ bổ sung tiêu chí được yêu cầu, trước deadline. |
| `SUPPLEMENT_REQUESTED` → `SUPPLEMENT_EXPIRED` | Scheduler | Deadline đã hết. |
| Trạng thái chờ thẩm định hợp lệ → `FINALIZED` | ADMIN | Đợt ở `FINAL_REVIEW`; server tính và lưu điểm/xếp loại chính thức. |

Mọi chuyển trạng thái phải cập nhật hồ sơ, `statusHistories` và audit/thông báo liên quan trong transaction phù hợp. Không có API tổng quát cho client tự đặt status.

## 6. Phản hồi, lịch sử, thông báo và audit

VC13: giao ước chi tiết tại [VC13_FEEDBACK_AUDIT_CONTRACT.md](./VC13_FEEDBACK_AUDIT_CONTRACT.md), có ưu tiên với các mô tả feedback/history/audit rút gọn bên dưới

- `POST /evaluations/:evaluationId/feedback` request:

  ```json
  {
    "type": "UNIT_REPLY",
    "content": "Đơn vị đã bổ sung tài liệu theo yêu cầu."
  }
  ```

  Backend tự đặt `authorId` từ CurrentUser. Response `201 Created` gồm `id`, `evaluationId`, `authorId`, `type`, `content`, `createdAt`.
- `GET /evaluations/:evaluationId/feedback` trả `{ "items": [...] }`, chỉ với người có quyền trên hồ sơ.
- `GET /evaluations/:evaluationId/status-history` trả `{ "items": [{ "fromStatus": "DRAFT", "toStatus": "PENDING_REVIEW", "actorId": "...", "comment": null, "createdAt": "..." }] }`; actor null biểu thị tác vụ hệ thống.
- `GET /notifications` trả dạng phân trang chung; query `isRead=true|false`.
- `PATCH /notifications/:notificationId/read` response: `{ "isRead": true }`.
- `POST /notifications/read-all` response: `{ "updated": 3 }`.
- `GET /notifications/web-push/public-key` public; response `{ "publicKey": "<VAPID-public-key>" }`.
- `POST /notifications/web-push/subscriptions` nhận object `PushSubscription` của trình duyệt; server gắn user từ token, response metadata subscription, không trả private key.
- `DELETE /notifications/web-push/subscriptions/current` nhận `{ "endpoint": "https://push-service.example/..." }`; response `{ "revoked": true }`.
- Audit log chỉ ADMIN đọc; thao tác ghi audit nội bộ không nhận actor tùy ý từ client.

## 7. Dashboard và xuất báo cáo

### Dashboard

`GET /admin/dashboard?periodId=<UUID>` — ADMIN.

Trả `periodId`, `period` (`id/year/name/phase/maxTotalScore`), `totalUnits` bằng số hồ sơ kỳ, `statusCounts` cho từng trạng thái, `notSubmittedCount = DRAFT`, `supplementPendingCount = SUPPLEMENT_REQUESTED`, `submittedCount = totalUnits - DRAFT - SUPPLEMENT_REQUESTED`, `progressPercent = submittedCount / totalUnits * 100` (0 khi kỳ rỗng), `finalizedCount`, `notFinalizedCount`, `officialResults` (chỉ hồ sơ FINALIZED) và `scoreDistribution`

`GET /admin/dashboard/leaderboard?periodId=<UUID>&limit=20` — ADMIN, `limit` tùy chọn từ 1 đến 100, mặc định 20, trả `totalUnits` và `items` theo `rank` ổn định từ view; mỗi item có `rank`, `scoreRank`, `evaluationId`, `unitId`, `unitCode`, `unitName`, `status`, `submittedAt`, `maxTotalScore`, `selfTotal`, `currentTotal`, `currentPercent`, `suggestedRating`, `ratingLabel`, `ratingColor`, `isFinal`; `isFinal=false` phải hiển thị là tạm tính. `rank/scoreRank` là số khi an toàn JSON, chuỗi thập phân khi vượt `Number.MAX_SAFE_INTEGER`

`GET /admin/dashboard/score-distribution?periodId=<UUID>` — ADMIN, trả `finalizedCount`, `items` theo xếp loại chính thức (`rating/label/color/count/percent`) và `buckets` phần trăm `[0,50)`, `[50,65)`, `[65,85]`, `(85,100]`, chỉ tính hồ sơ FINALIZED; kỳ rỗng trả số không và mảng bucket số không

`GET /admin/dashboard/criteria-deductions?periodId=<UUID>` — ADMIN, chỉ tính các ô của hồ sơ FINALIZED có `selfScore` và `adminScore` cùng tồn tại và `selfScore > adminScore`; trả `periodId`, `items` gồm `criterionId/code/name/unitsDeducted/totalPointsDeducted`, sắp theo tổng trừ giảm dần rồi số đơn vị, thứ tự tiêu chí và ID

`GET /admin/dashboard/criteria-deductions/:criterionId?periodId=<UUID>` — ADMIN, drill-down đúng một tiêu chí thuộc kỳ; trả `periodId`, `criterionId`, `items` gồm `evaluationId/unitId/unitCode/unitName/selfScore/adminScore/pointsDeducted`, chỉ từ hồ sơ FINALIZED có chênh lệch dương, sắp theo điểm trừ giảm dần rồi mã đơn vị và hồ sơ; tiêu chí không thuộc kỳ trả 404 tiếng Việt

Mọi endpoint dashboard yêu cầu ADMIN, trả `Cache-Control: no-store`; UUID/limit sai trả lỗi tiếng Việt và không trả lỗi Prisma/SQL thô

### Tạo và tải báo cáo

`POST /admin/reports/exports` — ADMIN.

Bảng tổng hợp:

```json
{
  "periodId": "33333333-3333-4333-8333-333333333333",
  "reportType": "SUMMARY_ALL_UNITS",
  "format": "XLSX"
}
```

Biên bản thẩm định một đơn vị:

```json
{
  "periodId": "33333333-3333-4333-8333-333333333333",
  "evaluationId": "44444444-4444-4444-8444-444444444444",
  "reportType": "UNIT_APPRAISAL_MINUTES",
  "format": "PDF"
}
```

`201 Created`:

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "periodId": "33333333-3333-4333-8333-333333333333",
  "evaluationId": null,
  "reportType": "SUMMARY_ALL_UNITS",
  "format": "XLSX",
  "createdAt": "2026-10-17T08:30:00.000Z",
  "status": "READY",
  "fileName": "summary-all-units-2026.xlsx",
  "sizeBytes": 16384,
  "createdById": "11111111-1111-4111-8111-111111111111",
  "downloadUrl": "/api/v1/admin/reports/exports/99999999-9999-4999-8999-999999999999/download?token=CHU_KY_NGAN_HAN",
  "downloadExpiresAt": "2026-10-17T08:32:00.000Z"
}
```

Format hợp lệ: tổng hợp đơn vị trong kỳ → `XLSX`; biên bản từng đơn vị → `PDF` hoặc `DOCX`. Evaluation phải thuộc `periodId` được gửi. Loại/định dạng hoặc scope không khớp trả `400 BUSINESS_RULE_VIOLATION`; UUID/payload sai trả `400 VALIDATION_ERROR`, kỳ/hồ sơ không tồn tại trả `404 NOT_FOUND`. `evaluationId` bị cấm với SUMMARY_ALL_UNITS, bắt buộc với UNIT_APPRAISAL_MINUTES, không chấp nhận null.

VC15 tạo đồng bộ: FE hiển thị đang tạo trong lúc POST chưa hoàn tất; `201` chỉ trả sau khi tệp private, metadata và audit `REPORT_EXPORTED` đã thành công. Không có trạng thái job giả hoặc bản ghi storagePath rỗng. Lỗi lưu tệp/generator/giao dịch trả lỗi tiếng Việt an toàn, bù xóa tệp mới; bộ dọn định kỳ thử lại với tệp mồ côi quá 24 giờ. Kho báo cáo local riêng `REPORT_EXPORT_DIR` mặc định `./storage/report-exports`, không được serve static; quyền thư mục/tệp lần lượt 0700/0600 trên hệ thống hỗ trợ. Không phụ thuộc secret của storage minh chứng hoặc provider thông báo.

Metadata tạo/xem/danh sách có `id`, `periodId`, `evaluationId`, `reportType`, `format`, `fileName`, `sizeBytes`, `createdById`, `createdAt`, `status: "READY"`, `downloadUrl`, `downloadExpiresAt`. `sizeBytes` là số nguyên an toàn; metadata không có storagePath. `GET /admin/reports/exports` nhận `periodId`, `evaluationId`, `reportType`, `format`, `page` (mặc định 1), `pageSize` (mặc định 20, tối đa 100), `sortBy=createdAt`, `sortOrder=asc|desc`; trả `{items,total,page,pageSize}`, sắp xếp phụ theo ID để ổn định trang. `GET /admin/reports/exports/:id` cấp lại metadata cùng URL tải mới.

`downloadUrl` có dạng `/api/v1/admin/reports/exports/:id/download?token=...`, chữ ký gắn người yêu cầu, mã báo cáo và mục đích riêng, hiệu lực mặc định 120 giây (`REPORT_EXPORT_DOWNLOAD_TTL_SECONDS`, 30–300 giây). Mọi đường vẫn yêu cầu access token ADMIN và đã đổi mật khẩu, kể cả khi biết URL. Tải bằng GET với Authorization, trả bytes XLSX/PDF/DOCX cùng Content-Type/Content-Disposition/Content-Length. Token sai, hết hạn, thuộc người khác hoặc báo cáo khác trả `403 FORBIDDEN` tiếng Việt; thiếu token trả `400 VALIDATION_ERROR`; tệp thiếu trả `404 NOT_FOUND`. FE lấy metadata mới ngay trước khi tải, không tự quyết định quyền bằng giờ máy. Mọi phản hồi báo cáo thành công đặt `Cache-Control: private, no-store`; không ghi signed token vào audit.

Dữ liệu xuất được đọc trong transaction RepeatableRead: chỉ hồ sơ thuộc kỳ, tổng Decimal chỉ từ lá, điểm hiện tại là adminScore nếu có hoặc selfScore, điểm chính thức/tỷ lệ/nhãn chỉ hiển thị khi FINALIZED. XLSX có STT/đơn vị/self/admin tạm tính/chính thức/%/nhãn/ghi chú, chú giải ngưỡng, tổng hợp, font Việt, A4 ngang và header lặp; mọi chuỗi người dùng là text, không là công thức. PDF/Word có nhóm và tiêu chí, điểm/lý do/minh chứng theo ID và tên, lịch sử/nhận xét/lịch bổ sung từ snapshot, tổng/%/nhãn và ô ký trống; chưa chốt ghi `CHƯA CHỐT — TẠM TÍNH`. Thời điểm hiển thị `Asia/Ho_Chi_Minh`; không dùng supplementHours tính lịch, không nhúng signed URL hoặc đường dẫn private của minh chứng. Bố cục VC00 là mẫu làm việc, chưa thay thế mẫu hành chính chính thức nếu giảng viên cung cấp sau này.


## Cấu hình phần trăm và giới hạn HTTP cập nhật 24/11/2026

PUT thresholds vẫn thay nguyên bộ trong transaction và ghi audit. Cần đúng một EXCELLENT/GOOD/PASS/FAIL; `FAIL = 0 < PASS < GOOD < EXCELLENT < 100`, tối đa hai chữ số thập phân. Chỉ EXCELLENT có `minExclusive=true`; các mức còn lại dùng `>=`. Bộ mặc định 85/65/50/0, bộ ví dụ 90/70/45/0 hợp lệ; EXCELLENT=100 bị chặn vì không thể đạt. Validator dùng chung khi lưu và publish-check. Mọi sửa ngưỡng bị chặn sau công bố, kể cả nhãn/màu. Self-summary, SQL view, chốt, dashboard và XLSX/PDF/DOCX đọc cấu hình của kỳ; so phần trăm chưa làm tròn.

Form tạo Excel là chức năng FE, không có API sinh file mới. Dữ liệu gồm đúng bảy cột chuỗi `unitCode,unitName,unitType,username,fullName,email,phone`, 1–100 dòng, không password/role/công thức; giữ giới hạn tệp 5 MiB. Dùng lại preview → confirm, chỉ confirm tạo tài khoản. Email hợp lệ chưa chứng minh người nhận; bước xác nhận Email không thay đổi.

HTTP runtime: JSON tối đa 1 MiB; giới hạn XLSX 5 MiB và minh chứng 10 MiB vẫn do từng endpoint. Login giới hạn theo cả IP (20/phút) và username chuẩn hóa (5/phút); refresh 30, onboarding 10, import 20, upload 60, retry/reset 10 lượt/IP/phút. HTTP 429 có `RATE_LIMITED`, thông điệp tiếng Việt và `Retry-After`. Bộ đếm dùng một process; cần store chung trước khi tăng replica. Auth/onboarding/credential/import trả `Cache-Control: no-store`. Proxy mặc định không được tin; `TRUST_PROXY` chỉ nhận mạng proxy được kiểm soát. Production bắt HTTPS, tắt Swagger và demo tools, bắt rate limit. `/api/v1/health` là healthcheck không ghi dữ liệu.
