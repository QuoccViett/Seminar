# Hướng dẫn cài đặt và chạy frontend

## Hồ sơ tự chấm VC09

UNIT mở `/unit/records` để đọc kỳ/hồ sơ thật, tạo bù khi đơn vị mới chưa có hồ sơ, nhập điểm/diễn giải, lưu từng lá hoặc tất cả thay đổi và nộp qua xác nhận. Giao diện giữ nháp khi polling hoặc lỗi lưu, có trạng thái từng ô, không cho nộp khi còn nháp. Reload sau lưu đọc lại dữ liệu đã lưu DB; bản nháp chưa lưu chỉ giữ trong phiên trang, không lưu xuống localStorage

Tổng/xếp loại tạm tính lấy từ score-summary API, quyền từng tiêu chí và cảnh báo sắp hết hạn lấy từ backend; FE chỉ dùng chênh lệch start/serverTime để hẹn hỏi lại API, không dùng giờ thiết bị để cấp quyền. Trước mở không tải summary hoặc hiển thị nội dung tiêu chí, sau hạn vẫn đọc được nội dung nhưng API khóa mọi đường ghi

ADMIN mở `/admin/records` để lọc kỳ, phân trang và xem cây/điểm tự chấm qua API thật. Thẩm định/yêu cầu bổ sung/nộp bổ sung thuộc VC12; upload/preview thuộc VC10. Không bật `VITE_API_MOCKING=enabled` khi nghiệm thu backend thật. Route, body, response và lỗi chi tiết tại [API_CONTRACT.md](./API_CONTRACT.md)



Phạm vi công việc của hai thành viên FE được ghi trong [FE_PHÂN CÔNG.md](./FE_PHÂN%20C%C3%94NG.md).

## Yêu cầu
- Node.js 22.13+ hoặc 24 và npm

## 1. Cấu hình frontend

Mở PowerShell ở thư mục gốc repository. Tạo file môi trường local từ mẫu:

```powershell
Copy-Item fe\.env.example fe\.env
```

Nếu `fe\.env` đã tồn tại, không ghi đè; cập nhật các biến cần thiết bằng tay.

Các biến hiện có:

```dotenv
VITE_API_URL=http://localhost:3000
VITE_WEB_PUSH_VAPID_PUBLIC_KEY=replace-with-public-vapid-key
```

- `VITE_API_URL`: địa chỉ backend, không thêm `/api/v1`; FE service tự thêm prefix API.
- `VITE_WEB_PUSH_VAPID_PUBLIC_KEY`: chỉ cần cấu hình khi nhóm bắt đầu tích hợp Web Push; có thể để nguyên giá trị mẫu lúc này.

Không bao giờ đặt VAPID private key, JWT secret, database password hoặc Supabase service-role key trong biến `VITE_*`.

## 2. Cài dependency và chạy Vite

Từ thư mục gốc:

```powershell
cd fe
npm ci
npm run dev
```

Mở URL Vite in ra ở terminal (mặc định thường là `http://localhost:5173`). Giữ terminal này mở trong khi phát triển; nhấn `Ctrl+C` để dừng frontend.

### Test và mock API

Frontend đã cấu hình **Vitest** để chạy test, **React Testing Library** để render/kiểm tra component và **MSW** để giả lập HTTP API. Các công cụ này là dependency của project, không cần cài global.

Sau khi clone hoặc khi lockfile thay đổi, mở PowerShell tại thư mục `fe` và cài dependency:

```powershell
npm ci
```

Chạy toàn bộ test một lần:

```powershell
npm test
```

Chạy test liên tục trong lúc sửa code:

```powershell
npm run test:watch
```

Đặt test component cạnh component với hậu tố `.test.jsx`, ví dụ `src/App.test.jsx`. Cấu hình test chung nằm ở `vite.config.js` và `src/test/setup.js`. MSW handler dùng chung được khai báo trong `src/mocks/handlers.js`; test gọi API thật qua `fetch`/client bình thường và handler sẽ trả fixture thay cho backend. Hiện có ví dụ `GET /api/v1/evaluation-periods` cùng test kiểm tra response phân trang.

Muốn chạy frontend với mock API trong trình duyệt:

1. Tạo `fe\.env.local` nếu chưa có; không ghi đè file này nếu đã có.
2. Thêm dòng sau vào `fe\.env.local`:

   ```dotenv
   VITE_API_MOCKING=enabled
   ```

3. Từ thư mục `fe`, chạy `npm run dev` (hoặc khởi động lại Vite nếu đang chạy).

MSW chỉ được bật trong chế độ development. Những request khớp handler sẽ nhận dữ liệu mock; request chưa có handler được chuyển tiếp bình thường tới backend. Để gọi backend thật, xóa dòng `VITE_API_MOCKING=enabled` hoặc đổi giá trị khác rồi khởi động lại Vite.

Service worker của MSW được lưu ở `fe\public\mockServiceWorker.js`; giữ file này trong repository để browser mocking hoạt động. Khi bổ sung handler, dùng đúng route, camelCase và response shape đã thống nhất trong [API contract](./API_CONTRACT.md); không bật mock trong production.

## 3. Các lần chạy tiếp theo

Ở thư mục `fe`, chỉ cần chạy:

```powershell
npm run dev
```

Không cần chạy lại `npm ci` trừ khi dependencies thay đổi. Sau khi đổi `.env`, khởi động lại Vite để nhận cấu hình mới. Khi pull thay đổi dependency, chạy `npm ci` trong `fe`.

## Các bước phát triển sau — thực hiện khi chức năng sẵn sàng

Các mục bên dưới **không cần làm chỉ để chạy bộ khung FE**. Làm từng phần theo API contract và khi chức năng tương ứng được bắt đầu.

### Tích hợp API backend

Để thử API thật, backend cần được cấu hình và chạy riêng theo [BE_HƯỚNG DẪN.md](./BE_H%C6%AF%E1%BB%9ANG%20D%E1%BA%AAN.md). Chạy backend và frontend ở hai terminal:

```text
Terminal 1: be → npm run start:dev
Terminal 2: fe → npm run dev
```

Backend mặc định ở `http://localhost:3000`; Swagger UI ở `http://localhost:3000/api/docs`. Nếu backend chạy ở host/port khác, cập nhật `VITE_API_URL` trong `fe\.env` rồi khởi động lại Vite.

FE dependency `axios` đã có trong `fe/package.json`, nhưng hiện chưa có Axios instance dùng chung (`apiClient.js`) và chưa có service nghiệp vụ. Khi bắt đầu tích hợp API, tạo `src/services/apiClient.js` để cấu hình `baseURL`, gắn access token và xử lý lỗi dùng chung; các service theo nghiệp vụ gọi qua client này. Tiện ích Web Push hiện tại trong `src/services/webPush.js` dùng Fetch API riêng.

### Làm giao diện trước khi API sẵn sàng

Có thể phát triển UI theo từng chức năng trước khi backend hoàn tất:

1. Chốt request/response và trạng thái giao diện với backend trong [API contract](./API_CONTRACT.md).
2. Dùng fixture/mock data cho loading, danh sách rỗng, dữ liệu thành công và lỗi.
3. Khi API chức năng đó sẵn sàng, đổi service sang API thật và kiểm thử quyền/trạng thái với backend.

### Bật Web Push với phiên đăng nhập hoặc liên kết mời

Web Push cần HTTPS hoặc `localhost`, trình duyệt hỗ trợ Push API và VAPID key ở cả backend/frontend. Người dùng phải chủ động bật notification từ một thao tác giao diện; không xin quyền khi render trang. Backend được hướng dẫn tại [BE_HƯỚNG DẪN.md](./BE_H%C6%AF%E1%BB%9ANG%20D%E1%BA%AAN.md).

Tạo/cấu hình cặp VAPID theo [hướng dẫn backend](<./BE_HƯỚNG DẪN.md>) và bật WEB_PUSH_ENABLED ở BE. FE đọc public key qua GET /api/v1/notifications/web-push/public-key; không cần chép key vào bundle. Private key chỉ nằm ở BE.

Sau khi có access token từ auth:

```js
import { enableWebPush, disableWebPush } from "./services/webPush.js";

await enableWebPush(accessToken);
await disableWebPush(accessToken);
```

`enableWebPush` xin quyền trình duyệt, đăng ký `public/sw.js`, tạo subscription và gửi subscription lên backend. Backend gắn subscription với user đã xác thực; FE không gửi `user_id`.

**Hiện trạng 24/11:** Auth/JWT, refresh và gắn subscription theo tài khoản đã tích hợp. Người chưa đổi mật khẩu dùng liên kết mời một lần qua luồng onboarding, không dùng token mời cho nghiệp vụ. Notification nghiệp vụ đi qua outbox/worker và ghi kết quả riêng từng kênh. Chỉ xác nhận nhận thật sau khi kiểm trên đúng thiết bị và HTTPS có chứng chỉ được tin cậy; cờ tắt hoặc thiếu subscription không được coi là SENT.

Khi đổi VAPID key, cập nhật cặp khóa BE và đăng ký lại subscription; FE lấy public key mới từ API. Không commit `fe\.env`; chỉ cập nhật `.env.example` nếu tên biến mẫu thay đổi, không đưa secret vào đó.


## Bổ sung ngày 24/11/2026

Quản lý tài khoản → Import Excel → Tạo danh sách Excel: nhập 1–100 dòng, số bắt đầu, số chữ số, hai tiền tố, hai mẫu tên `{n}`, domain email và loại đơn vị. Xem ba dòng ví dụ, tải XLSX để sửa hoặc đưa bản nháp vào preview. Chỉ nút xác nhận import tạo tài khoản; cần kiểm tra người nhận trước khi xác nhận Email.

Cấu hình và thẩm định có hai ô ngày giờ bổ sung theo giờ Việt Nam, chọn được mọi ngày. Xem trước rồi gửi yêu cầu; đổi một mốc sẽ xóa preview cũ. Thời lượng không bắt buộc bảy ngày. Ngưỡng phần trăm cho sửa trước công bố, giữ FAIL=0 và thứ tự Đạt < Tốt < Xuất sắc <100; khóa sau công bố. Backend quyết định quyền theo giờ server.

Palette dùng chung tại `src/theme.js` và biến CSS: xanh #1d4ed8, nền #f1f5f9, panel #eff6ff, chữ #0f172a, thành công #15803d, cảnh báo #b45309, lỗi #b91c1c. Trạng thái luôn có chữ, focus có viền; bảng cuộn trong vùng riêng trên mobile. Palette cần người phụ trách UI xác nhận trước nghiệm thu cuối.
