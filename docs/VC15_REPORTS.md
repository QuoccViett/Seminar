# Báo cáo VC15

Backend NestJS/Prisma/PostgreSQL tạo báo cáo thật và lưu bytes trong kho riêng. ADMIN đã đổi mật khẩu mở `/admin/reports`, chọn kỳ, chọn tổng hợp Excel hoặc biên bản PDF/Word của một hồ sơ rồi tạo. Lịch sử có lọc và phân trang. Nút tải luôn xin metadata mới để lấy chữ ký còn hạn; vẫn cần access token ADMIN.

## Cấu hình

Trên Render không có disk bền vững, đặt `REPORT_EXPORT_PROVIDER=supabase`, `SUPABASE_URL` và `SUPABASE_KEY` ở backend. `REPORT_EXPORT_BUCKET` mặc định dùng `STORAGE_BUCKET` (hoặc `evidences`); bucket phải private. Tệp báo cáo nằm dưới prefix `reports/`, vẫn tải qua API có chữ ký và JWT ADMIN. Provider không thay quyền bucket. Khi chuyển kho, sao lưu và chép các file cũ sang cùng key `reports/<periodId>/<exportId>-<fileName>` trước khi restart; metadata không đổi. Mặc định `local` giữ hành vi cũ cho development hoặc máy có volume riêng.

`REPORT_EXPORT_DIR=./storage/report-exports` là thư mục local private, không đặt trong static root, thư mục FE hoặc thư mục được web server công khai. Mount volume riêng và giữ thư mục này khi chuyển máy/khôi phục cùng PostgreSQL. Quyền tạo thư mục/tệp là 0700/0600 trên hệ thống hỗ trợ; Windows cần ACL tài khoản chạy ứng dụng tương ứng. Đây là kho local thật, không phải mock hay provider đám mây.

`REPORT_EXPORT_DOWNLOAD_TTL_SECONDS=120` nhận 30–300 giây. Chữ ký ràng buộc mã báo cáo và người đọc, có audience/mục đích riêng; không dùng thay access token. Khóa hoặc buộc đổi mật khẩu tài khoản vẫn chặn tải dù chữ ký còn hạn. Không ghi URL ký vào audit, localStorage hay log.

`REPORT_EXPORT_FONT_PATH` để trống dùng Noto Sans được đóng gói tại [assets/fonts](../be/assets/fonts/). Khi đóng gói phải giữ cả thư mục này bên cạnh `dist`. Không cần secret/template Email, Push, ZNS hay Supabase để xuất báo cáo local. Không tự gửi báo cáo ra người nhận.

## Dữ liệu và phục hồi

Snapshot RepeatableRead giữ kỳ, ngưỡng, cây, điểm, minh chứng công khai, lịch sử và phản hồi nhất quán. Chỉ cộng tiêu chí lá bằng Decimal; điểm hiện tại fallback từ thẩm định sang tự chấm, điểm chính thức chỉ hiện khi FINALIZED. Giữ lịch bổ sung đã lưu, không cộng supplementHours hoặc dùng đồng hồ FE để cấp quyền.

Tạo đồng bộ: ghi tệp trước, ghi ReportExport và audit trong một transaction sau đó. Thất bại bù xóa tệp; khi crash hoặc xóa bù chưa được, bộ dọn sau khởi động và mỗi giờ chỉ xóa tệp đúng namespace hơn 24 giờ không có tham chiếu DB. DB lỗi thì giữ tệp để thử lại. Bộ dọn không xóa metadata hoặc báo cáo có tham chiếu; không áp retention tự động cho báo cáo đã xuất.

XLSX có chú giải, số thật, font Times New Roman, A4 ngang và header lặp. Chuỗi người dùng luôn là text, không thành công thức. PDF nhúng font Unicode; Word dùng OOXML với văn bản thuần. Biên bản có điểm, diễn giải/lý do, ID/tên minh chứng, baseline và mốc bổ sung, lịch sử, phản hồi, tổng và phần ký trống. Trước chốt ghi “CHƯA CHỐT — TẠM TÍNH”. Bố cục là mẫu làm việc VC00, cần đối chiếu nếu được cung cấp mẫu hành chính chính thức về sau.

## Kiểm tra trên DB cô lập

Không dùng DATABASE_URL của ứng dụng chung. Tạo PostgreSQL local riêng có tên DB `vc15_test`, đặt `VC15_TEST_DATABASE_URL` trỏ đúng DB đó và áp migration bằng `DATABASE_URL` riêng.

```powershell
$env:DATABASE_URL=$env:VC15_TEST_DATABASE_URL
npx prisma migrate deploy
npm run build
node --import tsx --test src/modules/exports/exports.service.spec.ts
node --import tsx --test test/integration/vc15.exports.test.ts
```

Kiểm tích hợp dùng HTTP và kho local thật; đọc lại XLSX bằng ExcelJS, Word bằng ZIP/XML, PDF bằng PDF.js 6.5.438 ở dev dependency yêu cầu Node 22.13 trở lên. Bài kiểm có lỗi storage/font/audit chủ động để chứng minh không lưu thành công giả, không gửi provider ngoài. Tệp kết quả kiểm nằm trong `.tmp/vc15-artifacts`, không commit dữ liệu hoặc credential thử.

Browser fixture: chạy `test/integration/vc15.browser-fixture.ts` với `VC12_HTTP_PORT` và `VC15_FE_ORIGIN` riêng, bật FE bằng `VITE_API_URL` trỏ backend fixture và `VITE_API_MOCKING=disabled`. [Script Chrome](../be/test/browser/vc15.reports.mjs) chạy bằng `node --import tsx`, nhận `VC15_PLAYWRIGHT_MODULE`, `VC15_BROWSER_EXECUTABLE` và `VC15_FE_ORIGIN`. Script đăng nhập bằng tài khoản fixture, tạo/tải ba định dạng rồi đọc bytes và đối chiếu DB qua API. Không dùng mock của unit/component test để báo hoàn thành tính năng.
