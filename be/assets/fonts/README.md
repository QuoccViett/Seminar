# Font báo cáo PDF

Noto Sans Regular và Bold được nhúng vào PDF để hỗ trợ tiếng Việt, trích text và hiển thị trên máy không cài font. Hai tệp lấy từ dự án Noto chính thức, phân phối theo SIL Open Font License 1.1 trong [OFL.txt](./OFL.txt).

- [NotoSans-Regular.ttf](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf)
- [NotoSans-Bold.ttf](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf)

Giữ thư mục `assets/fonts` khi đóng gói backend. Build TypeScript không chuyển hoặc sinh lại font. `REPORT_EXPORT_FONT_PATH` tùy chọn chỉ thay font thường; để trống dùng bản đóng gói, không fallback sang font không hỗ trợ Unicode.
