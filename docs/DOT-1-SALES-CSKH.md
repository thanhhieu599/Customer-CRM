# Đợt 1 — Công cụ bán hàng và chăm sóc khách hàng

## Luồng thống nhất

Khách hàng → Cơ hội → Báo giá nhiều phiên bản → Nhiệm vụ theo dõi → Kết quả bán hàng.

- **Ngày làm việc** (`/workbench`): nhiệm vụ đến hạn/quá hạn, báo giá đã gửi cần phản hồi, cơ hội đến lịch và ticket sắp trễ theo ngày kinh doanh Việt Nam. Nhân viên ghi kết quả ngay tại đây. Mỗi nhóm hiển thị tối đa 100 mục sớm nhất, có ghi rõ giới hạn.
- **Cơ hội & Báo giá** (`/opportunities`): Kanban sáu giai đoạn, kéo thả hoặc chọn giai đoạn; yêu cầu lý do thua. Trang chi tiết quản lý lịch theo dõi, báo giá và PDF. Board phân trang 100 thẻ; số mỗi cột là số trên trang, không phải tổng toàn hệ thống.
- **Khách hàng**: lưu bộ lọc cá nhân, lọc tag/lâu chưa liên hệ, chọn khách trên trang để thêm tag, giao việc hoặc chuyển phụ trách. Mỗi yêu cầu tối đa 100 khách, toàn bộ danh sách phải có quyền truy cập.
- **Kiểm tra khách trùng** (`/duplicates`): chỉ quản lý; chọn hồ sơ giữ lại, xem số bản ghi sẽ chuyển, xác nhận trước khi hợp nhất. Gợi ý so khớp MST/email/điện thoại/tên chuẩn hóa; đây là dấu hiệu, không phải kết luận tự động. Quét tối đa 10.000 khách, trả tối đa 100 cặp, có thông báo phạm vi.
- Hồ sơ Customer 360 có liên kết trực tiếp đến cơ hội của khách. Lịch sử cơ hội, báo giá, giao việc và hợp nhất dùng chung timeline/audit hiện có.

## Quy tắc nghiệp vụ

### Phân quyền và cập nhật đồng thời

- Quyền cơ hội và PDF theo **người phụ trách khách hàng**, không tạo thêm một hệ quyền độc lập. Quản lý thấy toàn bộ; nhân viên chỉ thấy khách mình phụ trách.
- Chuyển người phụ trách khách đồng thời chuyển quyền cơ hội và báo giá. Nhiệm vụ đã giao vẫn giữ người thực hiện.
- Chặn việc nhân viên tự đổi owner hoặc dùng tham số ownerId để vượt phạm vi khách.
- Các mutation sales, bulk, merge và hoàn thành nhiệm vụ dùng transaction Serializable. Cơ hội có version để từ chối ghi đè dữ liệu cũ (409); người dùng tải lại rồi thử lại.
- Hoàn thành nhiệm vụ bắt buộc kết quả; không cho PATCH status=DONE để bỏ qua bước này. Gửi lặp không ghi thêm kết quả/timeline.

### Báo giá

- VND, lượng tối đa ba chữ số thập phân, tiền hai chữ số thập phân. Backend tính bằng số nguyên cố định: làm tròn từng dòng, trừ chiết khấu toàn báo giá, rồi tính VAT. Không tin trường tổng tiền do trình duyệt gửi.
- Mỗi phiên bản chụp thông tin khách và dòng hàng riêng, không sửa âm thầm PDF đã phát hành. Mỗi cơ hội chỉ có một bản nháp hiện hành; bỏ bản nháp nếu muốn lập lại.
- DRAFT → SENT hoặc REJECTED; SENT → ACCEPTED hoặc REJECTED. Đã hết hiệu lực không được gửi/đồng ý. Hạn theo dõi phải ở tương lai và trong thời hạn báo giá khi lập.
- “Đánh dấu đã gửi” là thao tác nhân viên ghi nhận đã gửi bên ngoài; **chưa tự gửi email/Zalo**. Gửi tạo đúng một nhiệm vụ liên kết báo giá, kể cả khi gửi đồng thời.
- Lập bản nháp mới vẫn giữ phiên bản đã gửi có hiệu lực. Chỉ khi gửi bản mới thì bản cũ thành SUPERSEDED, nhắc cũ bị hủy và nhắc mới được tạo. Khách vẫn có thể đồng ý bản đã gửi khi bản mới còn nháp; lúc đó nháp mới bị thay thế.
- ACCEPTED đóng cơ hội thành WON, hủy nhắc còn mở. Chốt WON/LOST thủ công cũng hủy nhắc. Chưa tự tạo đơn hay ghi nhận doanh thu đã bán: dữ liệu đơn hàng hiện có vẫn là nguồn doanh thu thực tế.
- Cơ hội WON/LOST không sửa hoặc mở lại trong phiên bản này.
- PDF nhúng font DejaVu hỗ trợ tiếng Việt, có giấy phép kèm theo; có đánh dấu bản nháp/bản hết hiệu lực do từ chối hoặc thay thế.

### Hợp nhất

- Chặn hợp nhất khi hai MST đã chuẩn hóa khác nhau. Không gộp tự động và không có nút hoàn tác tự động.
- Bước xem trước trả token của dữ liệu/đếm quan hệ. Dữ liệu thay đổi trước xác nhận thì từ chối và yêu cầu xem trước lại.
- Giữ giá trị đã có của hồ sơ chính, điền trường trống từ nguồn, ghép ghi chú/tag. Chỉ giữ đồng ý marketing nếu cả hai cùng đồng ý.
- Chuyển người liên hệ, đơn, hoạt động, nhiệm vụ, ticket, cơ hội, lịch sử tự động và mã đồng bộ. Không tự xóa người liên hệ hoặc đơn hàng vì giống nội dung.
- Giữ một nhiệm vụ tự động mở sớm nhất nếu hợp nhất làm xuất hiện nhiều nhiệm vụ tự động; các nhiệm vụ còn lại được hủy và giữ lịch sử. Nhiệm vụ thủ công/báo giá không bị gộp tùy tiện.
- Tính lại doanh thu (Decimal), chu kỳ, phân khúc và sức khỏe bằng cùng thuật toán retention hiện có.
- Hồ sơ nguồn được ẩn, giữ liên kết mergedIntoId và snapshot trước hợp nhất trong audit. Nhập đơn qua mã cũ của hệ thống khác cũng đi theo liên kết về hồ sơ chính, kể cả chuỗi nhiều lần hợp nhất.

## Chạy và kiểm thử

Node 22, PostgreSQL 16, Redis 7. Từ gốc repository:

```bash
npm ci
# Chỉ tạo .env nếu chưa có; không ghi đè cấu hình hiện hữu.
test -f apps/api/.env || cp apps/api/.env.example apps/api/.env
docker compose -f docker-compose.dev.yml up -d
npm run prisma:generate -w apps/api
npm run prisma:deploy:wasm -w apps/api
npm run db:seed                 # chỉ dùng database demo
npm run dev:api
# Terminal khác:
npm run dev:web
```

`prisma:generate` dùng generator TypeScript/WASM chính thức, được pin trong lockfile. `prisma:deploy:wasm` áp dụng chính các migration chuẩn, có bảng lịch sử Prisma; không bỏ xác minh TLS/checksum. Các API nội bộ Prisma được pin đồng phiên bản; khi nâng Prisma cần chạy lại kiểm thử migration và bộ test. Lệnh native `prisma:migrate`/`prisma:deploy` vẫn có để dùng khi tải được native engine. Không sửa migration đã áp dụng.

Build dùng Webpack được Next.js hỗ trợ vì Turbopack gặp lỗi worker trong cloud hiện tại. Font PDF được Nest sao chép vào dist.

```bash
npm run lint
npm test -w apps/api -- --runInBand
npm run build
```

**E2E backend:** dùng một database riêng, trống và đã migration, ví dụ `crm_phase1_test`. Truyền DATABASE_URL cho cả migration và test; REDIS_URL nên chọn database Redis riêng. Suite cũ tạo dữ liệu cố định nên mỗi lượt toàn bộ suite cần database mới. Không reset database phát triển hoặc dữ liệu thật để chạy test.

```bash
DATABASE_URL='postgresql://crm:crm@localhost:5432/crm_phase1_test?schema=public' npm run prisma:deploy:wasm -w apps/api
DATABASE_URL='postgresql://crm:crm@localhost:5432/crm_phase1_test?schema=public' REDIS_URL='redis://localhost:6379/2' SCHEDULER_ENABLED=false npm run test:e2e -w apps/api
```

**Playwright:** tạo database disposable `crm_ui` trước, build API, rồi chạy:

```bash
npx playwright install chromium
npm run test:e2e -w apps/web
# Trong cloud đã có Chromium:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -w apps/web
```

Playwright tự migrate/seed database `crm_ui`, chạy API :4001, web :3001 và Redis DB 3; tách output Next tại `.next-e2e`. Có thể cấu hình `UI_TEST_DATABASE_URL`/`UI_TEST_REDIS_URL`, chỉ trỏ vào dữ liệu kiểm thử. Không mock API hoặc bỏ xác thực. Trace/ảnh được lưu khi lỗi; GitHub Actions đã có bước chạy và thu artifact, chưa được xác minh trên runner GitHub trong phiên làm việc này.

## Kết quả kiểm chứng trong cloud — 30/10/2026

- Build API và web thành công; frontend dùng Webpack.
- Typecheck API/web thành công khi chạy tuần tự với các server kiểm thử.
- 44/44 unit test, 29/29 e2e backend trên PostgreSQL 16/Redis 7 thật.
- 5/5 bài Playwright với Chromium thật: lập/chốt báo giá và tải PDF, bộ lọc + bulk + ghi kết quả, hợp nhất qua UI, lý do thua, giao diện điện thoại.
- Migration đã chạy trên database phát triển và các database kiểm thử trống. Chạy lại deploy trả danh sách migration áp dụng rỗng.
- Đã kiểm tra xung đột cập nhật cơ hội, gửi báo giá đồng thời, rollback bulk, quyền PDF sau chuyển owner, preview hợp nhất hết hạn và import qua mã cũ.
- GitHub Actions mới được cấu hình; chưa chạy remote. Chưa triển khai production, chưa kiểm thử tải hoặc tích hợp gửi email/Zalo.
