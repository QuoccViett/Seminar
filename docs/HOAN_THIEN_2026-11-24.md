# Kết quả hoàn thiện ngày 24/11/2026

Source bắt đầu từ nhánh `fix/admin-unit-ui`, commit `32b6a6f`, Git sạch. Đã triển khai và kiểm chức năng mới A/B/C, hardening, Docker/HTTPS, seed, tài liệu, slide và phục hồi trên môi trường local riêng. Các mục cần Supabase thật, hạ tầng bảo vệ, thiết bị hoặc người xác nhận được giữ mở; không kết luận toàn đồ án đạt 100% khi chưa có các bằng chứng đó.

**Kiểm lại và tiếp tục ngày 24/11:** đã push commit sản phẩm `ab8c047e87e1ef19f6432c5bad830b4d8d2bfd59` lên `fix/admin-unit-ui`. [CI 45248745539](https://github.com/giahan358/Seminar/actions/runs/45248745539) thành công cả bốn job; head_sha khớp commit này. Artifact `vc17-evidence` ID `14854758864` đã tải và đối chiếu SHA-256 với metadata GitHub: `0d034e2a5628c12282bfe51e03e772e8790dd9cb30a3220623cbde580fa9ab34`. Manifest VC17 có `complete=true`, đủ 42/42 bước, không fail/skip; browser 20/20 với `mockBackend=false`; coverage 96,19% dòng và 89,95% nhánh. Các con số của lượt tổng local lỗi phía dưới được giữ như lịch sử, không thay cho CI mới.

- [x] Kiểm credential lại trên DB local đang cấu hình: 35 `ALREADY_CHANGED`, `applied=false`; không có mật khẩu lịch sử còn khớp, không thay tài khoản và không gửi tin. Container DB được trả về trạng thái dừng sau kiểm
- [x] Audit toàn bộ dependency BE/FE lại: cả hai 0 cảnh báo ở mọi mức, gồm dependency phát triển
- [x] Xác nhận CI kỹ thuật VC17 của đúng commit sản phẩm; DoD VC01/VC02 local được đối chiếu, không còn giữ nhãn thiếu Auth/nested validation của mốc cũ
- [x] Đồng bộ danh sách API đủ 94 thao tác/78 đường dẫn từ OpenAPI, sửa hướng dẫn Auth/Web Push, Node/PDF.js và mô tả snapshot lịch bổ sung; không giữ route hoặc field snake_case cũ trong giao ước hiện hành
- [ ] Supabase private thật, máy chủ/URL và thiết bị bảo vệ, người xác nhận UI, hai lần diễn tập: vẫn thiếu chỉ định hoặc bằng chứng thực hiện; không dùng CI/Mailpit/local để đánh dấu thay

### Lượt CI tiếp theo và sửa độ ổn định browser

[Run 45250774899](https://github.com/giahan358/Seminar/actions/runs/45250774899), SHA `6e2209bf30dff9bbb495f5ef6e882e6296b90dc9` chỉ đổi tài liệu, có Gitleaks/BE/FE đạt nhưng browser dừng ở 16 nhóm kiểm do timeout khi tìm nút “Làm mới” sau thẩm định bổ sung. Artifact `14855803416` đã đối chiếu checksum, manifest giữ `complete=false` với một bước browser lỗi; không ghép nó thành lượt CI đạt. Unit 218/218 và toàn bộ 56 test HTTP/PG/seed/upgrade của lượt này vẫn đạt, coverage dòng 96,19%.

Kiểm độc lập trên Ant Design đang cài xác nhận khi có spinner, nút mang tên truy cập “loading Làm mới” và không khớp locator tên chính xác “Làm mới”. Đã đặt aria-label cố định trên nút làm mới của màn hồ sơ ADMIN/UNIT và dashboard UNIT; bổ sung assertion trong test UNIT ngay lúc đang tải. Browser tiếp tục dùng thao tác thật, chờ GET phase-options sau làm mới trước khi chọn giai đoạn; không force click, tăng timeout, retry toàn bộ hoặc bỏ assertion. Chẩn đoán lỗi chỉ lưu các nhãn tương tác cố định, không ghi DOM hay credential.

Đồng thời bỏ hai nhãn “lịch bổ sung tạm/chờ giảng viên xác nhận” ở màn review và tự chấm, hiển thị chính xác hai mốc UTC đã lưu theo giờ Việt Nam. Browser local trên DB mới đã đạt 20/20 sau sửa nhãn; sáu test component/trang đã kiểm lại đạt sau thêm assertion loading, lint FE và lint/syntax browser đạt. CI của bản sửa cần đối chiếu đúng commit mới. Giữ lại artifact CI lỗi và lượt local riêng; kết quả run cuối được ghi tại mục 14 của [checklist hiện hành](../../../TaiLieu/KE_HOACH_VIBE_CODING_TOAN_BO_DO_AN.md) và [Actions của nhánh](https://github.com/giahan358/Seminar/actions?query=branch%3Afix%2Fadmin-unit-ui).

[CI 45254807016](https://github.com/giahan358/Seminar/actions/runs/45254807016) của `a5ab74de71c5bf18760a5b446c2fc0b20f01284d` đã đạt cả bốn job sau sửa loading: manifest 42/42, complete=true, browser 20/20, coverage 96,19% dòng/89,95% nhánh. Artifact `14857308574` đã đối chiếu SHA-256 `fee24e9038e42bb8cf9a9ced48f0a6c787decbf50a4120b645ba69ce471d6804`. Run lỗi `6e2209b` giữ nguyên để đối chiếu.

### Kiểm lại ảnh responsive và các DB local

Ảnh sau API có thể vẫn chụp lúc React đang loading; công cụ kiểm restore đã được sửa để chờ dashboard có “Tổng hồ sơ kỳ”, UNIT có kết quả 75 điểm và nhãn lịch hiện hành trước khi chụp/đo mobile. Ảnh có dữ liệu phát hiện vùng tài khoản UNIT bị Space xuống hàng dưới header; CSS mobile ADMIN/UNIT giữ tiêu đề một dòng, vùng thao tác không co/xuống hàng và thu gọn tên cạnh avatar. Script kiểm thêm bounding box của nút tài khoản phải nằm trong header và viewport.

Đã dựng lại frontend Docker và chạy phép kiểm tăng cường trên HTTPS source `18443` và restore `18444`: hai vai trò/login/me, 75/GOOD, hash minh chứng và ba báo cáo, nhãn hai mốc hiện hành, dữ liệu desktop/mobile 390 px, không tràn ngang và nút tài khoản không bị khuất đều đạt. Đây là smoke local sau cập nhật UI, không thay hai lần diễn tập bảo vệ. Lint/syntax script và build frontend đạt; CI của commit chứa CSS/công cụ kiểm cuối cùng được đối chiếu riêng trong kế hoạch.

Kiểm credential thêm qua PostgreSQL source/restore Docker, chỉ so bcrypt trong bộ nhớ và xuất tổng số: mỗi DB có 35/35 ALREADY_CHANGED, applied=false. Cùng DB `localhost:5433/kpi_db`, cả ba DB local đã kiểm đều không còn mật khẩu lịch sử khớp; không suy ra môi trường chưa được chỉ định.

## Rà main và nhãn giao diện ngày 25/11/2026

Đã fetch và đối chiếu `main`/`origin/main` cùng SHA `9206fbb821e93d2e62dd782bbe3098f4793a0a97`, Git sạch trước khi sửa. Commit này chứa toàn bộ bản hoàn thiện `5207312` và hai PR #35/#36, gồm chỉnh màu/layout/favicon. [CI main 45434786181](https://github.com/giahan358/Seminar/actions/runs/45434786181) đã success đúng SHA. Các chức năng đã hoàn thiện trước đó có trong main; vẫn còn các nhãn kỹ thuật nêu bên dưới, nên không kết luận giao diện đã hết chỗ sót chỉ từ CI xanh.

Bản sửa được làm ở nhánh local `fix/ui-readable-messages`, giữ nguyên phần màu/layout đã merge; chưa commit, push hoặc gộp vào main trong lượt rà này. Không thay mã API, tên field, quyền/trạng thái, ngưỡng tính điểm, schema hoặc migration. Mã đơn vị/tiêu chí, tên đăng nhập và nội dung người dùng được giữ đúng dữ liệu gốc.

| Khu vực còn sót trên main | Xử lý đã thực hiện |
|---|---|
| Danh sách tài khoản hiển thị ADMIN/UNIT | Dùng nhãn vai trò tiếng Việt |
| Preview Excel in REQUIRED, tên field; kết quả import in PENDING/FAILED và errorCode | Hiển thị “Cần sửa”, tên cột/nội dung lỗi tiếng Việt; kênh gửi có trạng thái và lý do rõ ràng |
| Modal gửi credential/hộp thư in WEB_PUSH hoặc mã lý do | Tên kênh, trạng thái và lý do dùng danh mục chung; không phản chiếu lỗi provider thô hoặc hứa tự retry khi trạng thái đã FAILED |
| Ngưỡng cấu hình in EXCELLENT/GOOD/PASS/FAIL ở tiêu đề, hướng dẫn và tên truy cập | Nhãn Xuất sắc/Tốt/Đạt/Chưa đạt; giá trị gửi API vẫn giữ enum gốc |
| Review đã chốt in GOOD và fallback người duyệt bằng UUID; dashboard UNIT fallback rating/status | Hiển thị nhãn xếp loại của đúng kỳ, có bộ mặc định khi thiếu nhãn; fallback dễ hiểu cho trạng thái/người duyệt |
| Feedback/timeline fallback loại hoặc trạng thái bằng mã | Dùng nhãn tiếng Việt và trạng thái dự phòng có nghĩa; giữ nguyên nội dung phản hồi |
| Audit còn field camelCase, mã loại báo cáo/lý do/sự kiện và bộ lọc cần gõ mã | Bổ sung nhãn metadata; chọn hành động/đối tượng bằng tiếng Việt, query vẫn gửi mã gốc; chỉ dịch giá trị trong field enum, không đổi mã đơn vị/tên đăng nhập trùng enum |
| Seed ghép SUBMITTED/FINALIZED… vào body thông báo và comment lịch sử | Seed mới tạo câu tiếng Việt; FE đọc được đúng mẫu thông báo cũ theo loại sự kiện, không sửa lịch sử DB để làm xanh UI |

[Danh mục nhãn và thông báo](../fe/src/services/displayLabels.js) dùng chung cho lỗi API, lỗi batch, import, gửi thông báo và xếp loại. Bộ kiểm mới xác nhận giữ định danh field để Form gắn lỗi, giữ nhãn kỳ tùy chỉnh và không dịch nhầm dữ liệu người dùng. Nhánh lỗi mã lạ dùng câu dự phòng, không in enum làm nội dung.

Kết quả kiểm local trên bản sửa:

- [x] Full FE **64/64 test**, 19 tệp, 0 fail; sau rà wording retry, kiểm lại ba tệp liên quan **8/8** đạt
- [x] ESLint FE, ESLint seed/fixture/browser, TypeScript `--noEmit` đạt; build production FE đạt (giữ cảnh báo bundle lớn đã có)
- [x] Seed integration trên DB `ci_seed` mới **1/1**: hai lần seed, đủ 34 đơn vị/35 tài khoản/42 hồ sơ, nội dung mẫu không ghép enum; hồ sơ, dữ liệu con và hash/version mật khẩu giữ nguyên khi chạy lại
- [x] Browser **22/22 nhóm**, Nest/PostgreSQL/storage thật, `mockBackend=false`: thêm modal trạng thái gửi và workbook thiếu tên đơn vị; kiểm tên trường/lý do tiếng Việt, confirm bị khóa và preview chưa tạo user; kiểm ngưỡng, kết quả chốt 84/Tốt, quyền, lỗi mạng, hai vai trò và mobile 390 px
- [x] Runner chọn `seed,browser` hoàn tất 5/5 bước build/migrate/seed/migrate/browser, manifest `complete=true`; không coi đây là chạy lại toàn bộ VC17 hay coverage của commit mới

Các log lượt đầu được giữ riêng, không sửa thành đạt. Một lượt cần cập nhật test bộ lọc audit sang thao tác tìm/chọn option của Select; một lượt full dùng lẫn cache khi module được bổ sung lúc runner còn chạy, đã chạy lại toàn bộ trên bản cố định đạt 64/64. Kết quả cuối nằm ở `be/.tmp/ui-labels-fe-final.log`, `ui-labels-delivery-final.log`, `ui-labels-browser/suite-results.json` và `ui-labels-browser/evidence`; đây là bằng chứng local bị Git bỏ qua. Không gửi Email/Push/ZNS thật, không reset DB dùng chung hoặc ghi bucket ngoài.

Các điều kiện Supabase thật, triển khai Vercel/Render/máy đích, nhận Email/Push thật và diễn tập không được nghiệm thu lại trong lượt rà nhãn này. CI main ở trên xác nhận bản gốc `9206fbb`, không phải các thay đổi local chưa push.

## Đối chiếu quy chuẩn UI và điều kiện deploy ngày 25/11/2026

Đã fetch lại: `origin/main` vẫn là `9206fbb821e93d2e62dd782bbe3098f4793a0a97`; API GitHub xác nhận [CI 45434786181](https://github.com/giahan358/Seminar/actions/runs/45434786181) completed/success đúng SHA. Các sửa nhãn ở nhánh local `fix/ui-readable-messages` chưa commit/push nên chưa nằm trong bản main đó.

Đối chiếu với [quy chuẩn nhóm cung cấp](../../../TaiLieu/UI_STYLE_GUIDE.md):

- [x] Chủ đạo `#3563A9`, hover `#2C528E`, nền trang/thẻ/sidebar/menu, chữ chính/phụ và ba màu thành công/cảnh báo/lỗi khớp cấu hình [theme](../fe/src/theme.js) và [CSS chung](../fe/src/index.css). Font hệ thống được giữ, nội dung 15 px, chữ phụ/tag 13 px; mobile input 16 px.
- [x] Tag thống kê số 0 dùng trung tính; tag trạng thái hồ sơ giữ màu theo trạng thái, không phụ thuộc số lượng.
- [x] Ba chức năng mới đã hiện diện: hai DatePicker ngày giờ bổ sung, form sinh Excel tối đa 100 dòng rồi preview/confirm, cấu hình bốn ngưỡng và khóa sửa khi công bố. Bằng chứng hồi quy là lượt local 64 test FE và 22 nhóm browser ở mục trên; lần đối chiếu này chỉ đọc code/log, không chạy lại hoặc kiểm URL public.
- [x] Có bằng chứng desktop/mobile 390 px hai vai trò, bảng cuộn và vùng thao tác header trong viewport. Đây là phạm vi đã kiểm, không suy ra đã thử mọi thiết bị hoặc nhận xác nhận thẩm mỹ từ nhóm.
- [x] Lượt chốt tiếp theo đã đổi nền tiêu đề bảng từ `#C3D4EE` sang `#E4E9EE` trong cả theme và CSS, theo đúng tài liệu người dùng chỉ định.
- [x] Đã thay chữ thường ở cột Xếp loại Tổng quan bằng `RatingTag` dùng `row.ratingColor`; bảng và phân bố cùng thành phần, chọn chữ đen/trắng có tương phản cao hơn, thiếu màu dùng trung tính. Đã cập nhật assertion FE tương ứng.
- [x] Người dùng chỉ định chốt theo quy chuẩn, không cần xác nhận/gộp nhánh Huy. PR #35/#36 giữ nguyên; nhánh cũ không phải điều kiện chặn release và không được gộp mock/luồng cũ vào main.

Trước khi lấy bản deploy cuối, đối chiếu SHA main và CI của chính release trong GitHub Actions; kết quả local không thay kết quả remote.

Có thể bắt đầu chuẩn bị môi trường hoặc deploy thử; chưa đủ bằng chứng đóng toàn bộ UI/nghiệm thu. Repository đang có đường triển khai Docker/Compose, chưa có cấu hình Vercel/Render riêng. Với hướng Vercel FE + Render BE, cần đặt `VITE_API_URL` là origin BE (client tự nối `/api/v1`), tắt mocking, cấu hình SPA rewrite để tải trực tiếp route con, CORS/WEB_ORIGINS đúng origin FE, DB/migration/seed, secret và Swagger production.

Các điều kiện provider vẫn mở: bucket Supabase private thật, lưu báo cáo bền vững, nhận Email/Push trên người nhận được chỉ định, smoke hai vai trò và backup/restore tại môi trường đích. [Vercel hướng dẫn rewrite cho SPA Vite](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas). [Render Free](https://render.com/docs/free) chặn SMTP 25/465/587 và ngủ sau 15 phút không có inbound; luồng SMTP/scheduler hiện tại cần phương án triển khai phù hợp. [Render disk](https://render.com/docs/disks) xác nhận tệp local mất sau restart/redeploy nếu không có persistent disk; báo cáo hiện dùng `REPORT_EXPORT_DIR`, nên chỉ bật Supabase cho minh chứng chưa giải quyết nơi lưu báo cáo. Các giới hạn hosting được đọc lại từ tài liệu chính thức trong lượt này; chưa thay provider hoặc gửi mail thật.

Lượt đối chiếu ban đầu chỉ đọc code/checklist. Sau đó người dùng yêu cầu sửa theo quy chuẩn và push main; phần cập nhật bên dưới là trạng thái mới, thay điều kiện chờ xác nhận UI ở các mục cũ.

## Chốt UI và hướng dẫn Vercel/Render ngày 25/11/2026

- [x] Áp dụng [quy chuẩn được lưu trong repo](./UI_STYLE_GUIDE.md): tiêu đề bảng `#E4E9EE`, màu nền tag xếp loại theo kỳ, chữ có tương phản; bỏ màu xanh riêng của nút Import Excel để kế thừa nút phụ/focus chung. Giữ nghiệp vụ, họ font, bố cục và responsive.
- [x] Gồm các sửa nhãn tiếng Việt ở lượt trước: không dùng enum/lỗi provider làm nội dung, giữ định danh API và dữ liệu người dùng.
- [x] Bổ sung [Vercel config](../fe/vercel.json) và [Render Blueprint](../render.yaml); BE bind `0.0.0.0` và đọc PORT của hosting. Mẫu Render dùng Starter + disk có phí, chưa tạo tài nguyên cloud.
- [x] Viết [hướng dẫn Vercel/Render](./DEPLOY_VERCEL_RENDER.md): build/start/root, DB/migration bằng owner tách runtime role, Supabase private, CORS/API URL, SMTP/AES, seed Admin, kiểm nhận thật và backup/restore cloud.
- [x] Render Blueprint qua JSON Schema chính thức; mọi thuộc tính đang dùng của Vercel config qua định nghĩa schema chính thức. Schema Vercel đầy đủ tự có ràng buộc experimentalTriggers sai draft ở phần không dùng; công cụ local chỉ lấy định nghĩa các thuộc tính có trong config, không bỏ kiểm giá trị cấu hình đang dùng. Liên kết nội bộ hướng dẫn mới tồn tại.
- [x] Component Tổng quan 2/2 đạt: màu tối/sáng, nhãn riêng của kỳ, trung tính khi thiếu màu và màu bảng/phân bố giống nhau. Lint FE đạt, còn warning từ MSW sinh tự động đã có.
- [x] Browser bản chốt **23/23 nhóm**, `mockBackend=false`, hai vai trò/390 px; xác nhận CSS thực tế của nút Import, tiêu đề bảng và màu kỳ giữa bảng/phân bố. Runner chọn browser đủ **3/3 bước** build/migrate/browser, `complete=true`; không coi là chạy lại toàn bộ VC17.
- [x] Lint BE các tệp sửa và TypeScript `--noEmit` đạt; build production FE cuối đạt, còn cảnh báo bundle lớn đã có. Gitleaks phần staged không phát hiện bí mật mới, diff không lỗi whitespace. Container kiểm đã dừng, Docker Desktop trả về tắt như đầu lượt.
- [ ] Bucket/DB/URL cloud, Email/Push nhận thật và diễn tập vẫn chờ triển khai; file cấu hình/hướng dẫn không thay bằng chứng môi trường thật.

Lượt browser đầu của phần kiểm màu dừng sau 19 nhóm vì fixture kỳ review chưa có màu (null), assertion yêu cầu màu hex chưa có điều kiện trước. Đã gán màu tùy chỉnh trong fixture riêng trước thao tác, không sửa DB ứng dụng; lưu lượt lỗi ở `.tmp/ui-style-browser`, tiếp tục trên PostgreSQL mới. Không nới assertion hoặc dùng mock backend.

## Checklist theo yêu cầu

| Mục | Kết quả đã kiểm | Trạng thái còn lại |
|---|---|---|
| 1. Credential lịch sử | Đối chiếu bcrypt trên DB local đang cấu hình và hai DB Docker source/restore: từng DB đều 35/35 ALREADY_CHANGED; không ghi secret, không đổi thêm hoặc viết lại Git | Chủ các môi trường khác nếu có cần kiểm riêng; không thể suy ra từ ba DB local |
| 2. Dependency | BE và FE đều 0 cảnh báo khi audit toàn bộ dependency, gồm dev; SMTP Mailpit/import/report/auth/coverage đã hồi quy | Chạy lại audit khi làm release mới vì advisory có thể thay đổi |
| 3. CI | SC2034 đã sửa; [CI 45248745539](https://github.com/giahan358/Seminar/actions/runs/45248745539) của `ab8c047` xanh Gitleaks/BE/FE/VC17; artifact khớp checksum, 42/42 bước đạt | Đã xác nhận commit sản phẩm; các release sau phải đối chiếu SHA/run riêng |
| 4. Lịch bổ sung | BE/FE nhận đủ hai mốc, mọi ngày giờ; snapshot UTC, một vòng, retry so cả deadline, nhắc trong cửa sổ, giữ policy/trigger/seed/report | Đã đạt local HTTP/PG/browser và HTTPS demo; rollout môi trường đích cần kiểm kê yêu cầu đang mở |
| 5. Sinh Excel | Form số lượng/số bắt đầu/chữ số/tiền tố/mẫu tên/domain/loại đơn vị; 1/34/100 dòng chuỗi, tải/sửa/preview/confirm thật, retry không trùng | Đã đạt local, giữ 100 dòng và 5 MiB |
| 6. Ngưỡng | Bốn rating, mặc định 85/65/50/0; validator chung lưu/publish, cận hợp lệ, khóa sau công bố; bộ 90/70/45/0 khớp summary/SQL/chốt/dashboard/XLSX/PDF/DOCX | Đã đạt local và demo HTTPS |
| 7. Màu UI | Palette chung, nền phân vùng, nhãn trạng thái/focus và màu xếp loại theo kỳ; chốt theo UI_STYLE_GUIDE ngày 25/11 | Người dùng chỉ định không chờ xác nhận nhánh Huy; kiểm bản chốt và CI theo lượt mới ở trên |
| 8. Tài liệu | Danh sách API hiện hành khớp 94 thao tác/78 đường dẫn OpenAPI, contract/Swagger/PTCSDL/hướng dẫn/README đã đồng bộ; context local được sửa khỏi mô tả cũ | Mẫu hành chính và người ký thật giữ phần xác nhận của nhóm |
| 9. Kiểm thử/DoD | CI mới xác nhận BE 218/218, browser 20/20, ba TZ, HTTP/PG/race/upgrade/seed; coverage 96,19% dòng/89,95% nhánh; FE/E2E trong job tương ứng xanh, đối chiếu VC01/02 ở bảng dưới | VC17 kỹ thuật đã đạt; kiểm trên môi trường đích ở VC10/18/20 vẫn chờ đầu vào |
| 10. Supabase thật | Provider private có guard; có công cụ upload/download/hash/cleanup riêng | Chưa có project/bucket được chỉ định; cấu hình local là placeholder nên chưa chạy thật |
| 11. VC18 | Rate limit, no-store, Swagger production 404, trust proxy, app role tối thiểu, BE/FE/proxy, HTTPS local, backup/restore và smoke sau restore đã đạt | Domain public/CA thiết bị/NTP máy chủ đích, bucket backup và Email/Push thật chưa được chỉ định |
| 12. VC19/20 | Seed base/demo riêng; 34 đơn vị, sáu trạng thái/bốn rating, minh chứng tự tạo; hướng dẫn cài/vận hành và slide HTML/PDF 12 trang đã có | Hai lần diễn tập trên URL/hạ tầng bảo vệ và thiết bị nhận thật chưa thực hiện |

## Kiểm thử và các lượt sửa lỗi

| Nhóm | Kết quả |
|---|---|
| BE unit | 218/218, 0 fail/skip; [runner](../be/scripts/run-tests.mjs) |
| FE | Full 55/55; kiểm lại generator/App 13/13 sau đổi form/theme; lint 0 lỗi, còn một warning từ MSW sinh tự động |
| Lịch/policy | 8/8 trên mỗi TZ UTC, Asia/Ho_Chi_Minh, America/New_York; helper kiểm đủ bảy ngày và khoảng 1 ms/45 phút/10 ngày |
| HTTP/PG | VC03–VC14, scheduler/recovery, seed, upgrade12/13/17 và system đều có lượt đạt; VC15 đọc bytes sau nâng PDF.js đạt 9/9; ngưỡng tùy chỉnh và Excel sinh có lượt riêng đạt |
| Browser mới | 20 nhóm kiểm, backend/storage/PostgreSQL thật, không MSW; gồm form Excel, cấu hình/publish, bắt đổi mật khẩu, biên server, PDF, feedback, bổ sung cuối tuần 45 phút và chốt |
| Entrypoint thật | E2E 2/2; test/production đều qua health/rate limit/no-store/CORS, Swagger test 200 và production 404 |
| Docker/HTTPS | BE/FE/PostgreSQL/Caddy khỏe; migrate/permissions hoàn tất trước runtime; app role không superuser/createdb/createrole, không UPDATE audit hay DELETE history |
| Smoke triển khai | HTTPS loopback, hai vai trò đổi mật khẩu lần đầu, chấm/upload/confirm/download khớp bytes, khóa hạn, một vòng bổ sung/retry, chốt 75/GOOD, dashboard và tải ba báo cáo |
| Backup/restore | Project mới `seminar-restore-completion`; checksum **26 bảng và 301 tệp** khớp trước khởi động; sau restore hai vai trò login/me thành công, kết quả 75/GOOD và minh chứng/XLSX/PDF/DOCX giữ đúng hash |
| Hiển thị triển khai | Màn ADMIN/UNIT đã tải dữ liệu rồi chụp desktop/mobile 390 px; không tràn ngang. Chứng chỉ localhost là CA nội bộ, Playwright bỏ kiểm CA cho lượt local |
| Bảo mật/kiểm tĩnh | Audit toàn bộ BE/FE 0; Actionlint/ShellCheck và quét secret phần nội dung mới đạt; typecheck/lint/build/schema phù hợp đã chạy |

Lượt tổng đầu được giữ nguyên với hai phần lỗi: bộ đọc PDF.js 6 đổi vòng đời `destroy`, và browser phát hiện ID trường trùng giữa hai Form. Đã sửa bằng `loadingTask.destroy()` và Form name riêng, rồi kiểm lại VC15 trên DB mới (9/9), ngưỡng/file, browser trên DB mới (20/20). Không đổi manifest lượt lỗi thành đạt. Coverage của lượt tổng đầu là 91,38% dòng; đây không thay cho coverage/CI của commit release cuối.

Các log/JSON/ảnh chi tiết nằm trong `be/.tmp` local bị Git bỏ qua. Báo cáo này lưu kết luận và giới hạn để vẫn đọc được khi dọn tệp tạm; CI phải xuất artifact riêng từ đúng commit. Không có thay đổi migration đã áp dụng hoặc backfill thời hạn đã thông báo.

## Đối chiếu DoD VC01 và VC02

| Điều kiện | Bằng chứng hiện tại | Kết luận |
|---|---|---|
| Payload lỗi bốn field, tiếng Việt, nested/array/field lạ/JSON/404/multipart/413 | Unit foundation/http-vc01, integration quyền/DTO và E2E main thật; filter không phản chiếu lỗi provider/SQL | Đạt phạm vi local |
| Log metadata, không bí mật; audit che dữ liệu lồng nhau | Unit middleware/audit trong 218/218 và log HTTPS chỉ requestId/method/status/duration | Đạt phạm vi local |
| Config theo cờ, UTC/Decimal/BigInt, UNIT thiếu/sai đơn vị bị chặn trước DB | Unit/config, VC03 HTTP/PG, policy ba TZ; production tắt Swagger và demo tools | Đạt phạm vi local |
| Login/refresh rotation/reuse/concurrency/logout/me, version và đổi mật khẩu | Auth/guard unit, VC03/auth/system và browser bắt đổi mật khẩu, khóa tài khoản mất phiên | Đạt phạm vi local |
| Min 8, Unicode/72 byte/username/hash cũ/phổ biến; FE nhận lỗi và giữ phiên đúng | Unit policy, system HTTP/PG và browser 7 ký tự bị chặn/8 ký tự được nhận | Đạt phạm vi local |
| Luồng frontend với backend thật, import/reset dùng mật khẩu cấu hình | Browser 20/20 và HTTPS hai vai trò/đổi mật khẩu/upload/chốt | Đạt phạm vi local |
| Release/rollout/provider thật | CI mới, bucket/domain/thiết bị/hạ tầng bảo vệ | Giữ ở VC10/17/18/20, không lẫn với DoD local |

## Vận hành và bàn giao

- [README cài đặt, seed, test, Docker và phục hồi](../README.md)
- [Contract](./API_CONTRACT.md), [API](<./danh sách api.md>), [OpenAPI](../be/docs/openapi.json), [schema](../be/prisma/schema.prisma)
- [Credential và dependency](./SECURITY_REMEDIATION.md), [kịch bản nghiệm thu](./DEMO_NGHIEM_THU.md)
- [Slide HTML](./bao-ve.html), [PDF 12 trang](./BAO_VE_DO_AN.pdf)
- [Backup/restore](../deploy/backup-restore.mjs), [Compose](../deploy/compose.yml), [mẫu env](../deploy/.env.example)
- [Kiểm Supabase thật](../be/scripts/verify-supabase.mjs), [smoke deployment](../be/scripts/verify-deployment.mjs), [đối chiếu restore](../be/scripts/verify-restored.mjs)

Secret, mật khẩu demo sau đổi, dump DB và backup tệp không nằm trong Git. Không bật gửi Email/Push cho người thật hoặc ZNS. Để đóng toàn bộ checklist cần chủ môi trường chỉ định bucket/project, domain/server, thiết bị nhận và người xác nhận UI; sau đó chạy đúng ma trận/kịch bản tại môi trường đó, không dùng kết quả local thay thế.
