# Đối chiếu credential và dependency ngày 24/11/2026

Nguồn credential đã lộ: commit `0dc91991cedd216ba86f5a318ad4bba6b5fe2f33`, tệp `be/credentials.json`. Tệp có 35 tài khoản (Admin và 34 đơn vị); Gitleaks lịch sử đánh dấu 34 dòng mật khẩu. Không chép giá trị mật khẩu vào báo cáo hoặc mã mới.

Đã đối chiếu bcrypt trong bộ nhớ với DB local `localhost:5433/kpi_db`: 35/35 tài khoản tồn tại và cả 35 hash đều không khớp mật khẩu lịch sử. Không cần đổi thêm trên DB này. Kết quả không xác nhận các môi trường hoặc bản sao đang chạy khác; cần chủ môi trường kiểm bằng cùng quy trình nếu có.

[Công cụ kiểm credential](../be/scripts/security-credentials.mjs) mặc định chỉ kiểm và ghi báo cáo đã loại secret. `--apply --database=<tên DB>` chỉ cho DB local được nêu rõ; khi còn hash khớp, công cụ cấp mật khẩu ngẫu nhiên private, bắt đổi lần đầu, tăng version, thu hồi refresh/subscription/onboarding, hủy payload dispatch cũ và ghi audit trong transaction. Không gửi credential cho người thật. Lịch sử Git chưa được viết lại; không coi việc thêm ignore là thay thế thu hồi credential.

Dependency production sau cập nhật: BE 0 và FE 0 cảnh báo từ `npm audit --omit=dev --json` trong lượt kiểm local. Nodemailer 10.6.1 sửa các advisory không có bản vá trong major 7; đường SMTP thực tế được kiểm lại bằng Mailpit trong VC06. Effect override 3.22.5 giữ API major 3 của Prisma config, không hạ Prisma. ExcelJS chỉ dùng uuid v4; override uuid 11.1.1 vẫn cung cấp CommonJS/browser và được kiểm bằng đọc/ghi XLSX/import/report. FE cập nhật follow-redirects 1.16.3 và DOMPurify 3.5.0 trong khoảng dependency tương thích. PDF.js ở bộ kiểm nâng lên 6.5.438 (yêu cầu Node 22.13+) và glob của test-exclude lên 14.0.6 để xử lý cả audit phát triển; bộ đọc bytes PDF và coverage được kiểm lại. Không dùng audit fix --force.

Báo cáo credential, audit JSON và log chi tiết nằm ngoài Git trong thư mục kiểm thử local. Khi kiểm release khác phải chạy lại audit vì advisory có thể thay đổi. Phần CI remote và phạm vi kiểm thử hoàn tất được ghi trong biên bản nghiệm thu của đúng commit.
