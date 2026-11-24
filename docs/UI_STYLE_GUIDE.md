# Quy chuẩn màu và cỡ chữ giao diện ADMIN và UNIT


Tài liệu dùng để đổi màu và tăng nhẹ cỡ chữ giao diện hiện tại. Đây là phương án mục tiêu, không phải xác nhận mọi màn hình đã áp dụng.

## 1. Phạm vi đã chốt

- Thống nhất màu sắc và tăng nhẹ cỡ chữ giữa ADMIN và UNIT.
- Giữ nguyên họ font hiện tại, khoảng cách, bo góc, kích thước nút và ô nhập, bố cục, căn lề, thứ tự menu và cách responsive hiện có. Chỉ điều chỉnh chiều cao vùng chứa khi cần để chữ lớn hơn không bị cắt hoặc chồng lấn.
- Giữ nguyên API, phân quyền, dữ liệu và nghiệp vụ.
- Không thiết kế lại màn hình hoặc thêm chức năng khi thực hiện yêu cầu đổi màu.
- Màu chủ đạo vẫn thuộc tone xanh dương. Mã đề xuất `#3563A9` trầm hơn mã hiện tại `#1D4ED8`; đây là thay đổi sắc độ, không phải giữ nguyên mã hiện tại.

## 2. Bảng màu dùng chung

| Thành phần | Màu |
| --- | --- |
| Chủ đạo: nút chính, liên kết, điểm nhấn | `#3563A9` |
| Nút chính khi hover | `#2C528E` |
| Nền trang | `#F3F5F7` |
| Nền thẻ, ô nhập và hộp thoại | `#FFFFFF` |
| Nền sidebar ADMIN và UNIT | `#EAF0F7` |
| Nền menu đang chọn | `#D8E5F5` |
| Chữ menu đang chọn | `#3563A9` |
| Nền tiêu đề bảng | `#E4E9EE` |
| Viền ngoài bảng | `#CBD3DE` |
| Viền ô nhập và đường chia bảng | `#D5DCE5` |
| Chữ chính, tiêu đề | `#253247` |
| Chữ phụ, chú thích | `#64748B` |
| Thành công | `#2F7D50` |
| Nền thành công | `#EAF5EE` |
| Cảnh báo | `#9A6700` |
| Nền cảnh báo | `#FFF4DA` |
| Lỗi / nguy hiểm | `#B33D3D` |
| Nền lỗi | `#FCEDEC` |
| Nền trung tính | `#F1F3F5` |

Dùng nền nhạt cho khối lớn; màu đậm dành cho chữ, biểu tượng và nút chính. Không dùng viền đen hoặc thêm màu chủ đạo khác tùy màn.

## 3. Áp dụng màu theo thành phần

| Thành phần | Quy tắc màu |
| --- | --- |
| Nút chính | Nền xanh chủ đạo, chữ trắng; hover xanh đậm hơn |
| Nút phụ | Nền trắng, viền chung, chữ chính |
| Nút liên kết | Chữ xanh chủ đạo |
| Nút nguy hiểm | Dùng đỏ lỗi theo kiểu nút hiện có |
| Form | Ô nhập nền trắng, chữ chính, viền chung; focus xanh chủ đạo, lỗi đỏ |
| Bảng | Nền trắng, tiêu đề `#E4E9EE`, chữ chính, đường chia xám nhẹ |
| Menu | Sidebar xanh nhạt; mục đang chọn có nền xanh nhạt đậm hơn và chữ xanh chủ đạo |
| Thông báo | Dùng chữ/icon theo màu trạng thái và nền nhạt tương ứng |

Áp dụng màu theo các quy tắc trên và cỡ chữ theo mục 5; giữ nguyên vị trí, khoảng cách, độ bo góc và căn giữa bảng hiện tại. Trạng thái vẫn có nhãn hoặc biểu tượng, không chỉ dùng màu để phân biệt.

## 4. Màu tag trạng thái hồ sơ

| Trạng thái | Nền | Chữ |
| --- | --- | --- |
| Đang tự chấm | `#EAF0F7` | `#3563A9` |
| Chờ duyệt / Chờ thẩm định | `#FFF4DA` | `#9A6700` |
| Được yêu cầu bổ sung | `#FFF4DA` | `#9A6700` |
| Đã nộp bổ sung | `#EAF0F7` | `#3563A9` |
| Đã hết hạn bổ sung | `#FCEDEC` | `#B33D3D` |
| Đã chốt | `#EAF5EE` | `#2F7D50` |

- Tag thống kê có số lượng bằng 0 trên dashboard: nền `#F1F3F5`, chữ `#64748B`. Không áp dụng quy tắc này cho tag trạng thái của từng hồ sơ.
- Dùng cùng quy ước ở dashboard, danh sách và chi tiết hồ sơ ADMIN/UNIT.
- Màu xếp loại cấu hình theo kỳ là dữ liệu nghiệp vụ riêng; không tự thay bằng màu tag trạng thái.

## 5. Tăng nhẹ cỡ chữ, giữ nguyên font

- Giữ nguyên họ font đang sử dụng; không tải hoặc thay sang font mới.
- Tăng khoảng **1–2 px** so với hiện tại cho nội dung, nhãn form, nút, menu, bảng, tag và thông báo. Ví dụ chữ 14 px tăng lên 15 px, chữ phụ 12 px tăng lên 13 px. Các ô nhập mobile đã đủ lớn thì giữ nguyên, không ép giảm cỡ chữ.
- Tiêu đề trang và tiêu đề thẻ chỉ tăng tối đa 1–2 px nếu cần; giữ nguyên thứ bậc tiêu đề, không phóng to đồng loạt hoặc tăng theo phần trăm toàn trang.
- Giữ độ đậm chữ hiện tại. Ưu tiên đọc rõ hơn nhưng vẫn gọn, tránh đổi bố cục chỉ để tăng chữ.
- Kiểm tra chữ trong nút, Select, DatePicker, tag, tiêu đề bảng và header không bị cắt, tràn hoặc che thao tác trên desktop và mobile 390 px. Cho phép vùng chứa tăng chiều cao tối thiểu cần thiết nếu chữ không vừa.

## 6. Màu bốn mức xếp loại trong bảng Tổng quan

- Bốn mức xếp loại (`EXCELLENT`, `GOOD`, `PASS`, `FAIL`) đã có màu trong cấu hình ngưỡng của từng kỳ. Dùng đúng **màu cấu hình tương ứng**, không gán một bảng màu cố định khác.
- Trong bảng xếp hạng tại Tổng quan ADMIN, tag ở cột **Xếp loại** phải có nền được tô bằng màu cấu hình của mức đó; không chỉ có một vạch màu ở mép tag trong khi nền vẫn trắng.
- Dùng `ratingColor` của dòng khi API đã cung cấp. Nếu cần đối chiếu cấu hình, ghép theo mã `rating` và đúng kỳ đang xem, không ghép theo nhãn tiếng Việt có thể được chỉnh sửa.
- Chọn chữ sáng hoặc tối phù hợp với nền màu để đọc rõ; không cố định chữ đen nếu nền cấu hình tối. Nhãn xếp loại vẫn luôn hiển thị.
- Không để style nền trắng/chữ cố định ghi đè màu xếp loại. Bảng Tổng quan và khối phân bố dùng cùng thành phần hiển thị, giữ đúng màu kỳ và độ tương phản của chữ.
- Khi chưa có xếp loại hoặc chưa có màu cấu hình, dùng tag trung tính với nội dung phù hợp, không tự suy ra mức hoặc phần trăm.
- Tag **Tạm tính** là nhãn riêng, không thay thế màu xếp loại. Cùng một mức ở bảng và khối phân bố xếp loại phải thể hiện cùng màu cấu hình.
- Chỉ sửa cách hiển thị; không thay đổi giá trị màu đã lưu, ngưỡng phần trăm hoặc kết quả tính xếp loại.

## 7. Mẫu yêu cầu để dùng lại

```text
Đọc docs/UI_STYLE_GUIDE.md và code giao diện hiện tại.
Đổi màu và tăng nhẹ cỡ chữ giao diện ADMIN và UNIT theo tài liệu.

Áp dụng cho nền trang, thẻ, sidebar, menu, nút, form, bảng, tag và thông báo.
Tiêu đề bảng dùng #E4E9EE. Chủ đạo dùng #3563A9.
Tag thống kê bằng 0 trên dashboard dùng màu xám trung tính.
Màu trạng thái dùng thống nhất giữa ADMIN và UNIT.
Giữ nguyên họ font; tăng khoảng 1–2 px cho chữ nội dung và thành phần giao diện.
Ví dụ 14 px thành 15 px, 12 px thành 13 px; không phóng to toàn bộ trang.
Tag xếp loại trong bảng Tổng quan tô nền đúng màu cấu hình theo kỳ,
chọn màu chữ dễ đọc và gỡ style nền trắng đang ghi đè màu.

Giữ nguyên họ font, bố cục, khoảng cách, bo góc, căn lề,
kích thước nút và ô nhập, thứ tự menu, responsive và hành vi hiện tại.
Chỉ tăng chiều cao vùng chứa tối thiểu khi cần tránh cắt hoặc chồng chữ.
Giữ nguyên API, phân quyền, chức năng và nghiệp vụ.
Không tự thay màu xếp loại lấy từ cấu hình kỳ đánh giá.

Nếu tạo ảnh mẫu, bám bố cục hiện tại, đổi màu và tăng nhẹ cỡ chữ theo tài liệu.
Không thêm thành phần hoặc chức năng mới vào ảnh.
```
