# Lộ trình 30 ngày – 3 lập trình viên

Bộ khung trong repo đã chạy được phần lõi của P0 (đăng nhập & phân quyền, Customer 360°, việc cần làm, ticket có SLA,
Retention Engine, dashboard, nhập CSV, Docker, CI). Vì vậy 30 ngày được dùng để **hoàn thiện theo quy trình thật
của công ty, nạp dữ liệu thật, kiểm thử với nhân viên và chạy production** – không phải viết lại từ đầu.

## Phân vai

| Người | Trách nhiệm chính |
|---|---|
| **Dev 1 – Frontend** | Giao diện theo góp ý nhân viên, Customer 360°, Dashboard, Tasks, Ticket; tối ưu thao tác hằng ngày (ít click, dùng được trên điện thoại) |
| **Dev 2 – Backend** | Schema, API, phân quyền, nghiệp vụ; rate limit đăng nhập; hiệu năng truy vấn; e2e test |
| **Dev 3 – Fullstack / Integration** | Retention Engine (hiệu chỉnh quy tắc), nhập/đồng bộ dữ liệu MISA, jobs, triển khai VPS, backup, giám sát. **Dựng staging ngay tuần 1**, không để tuần cuối |

Người dùng chủ chốt (1 trưởng nhóm CSKH/sales) tham gia 2–3 giờ/tuần để chốt yêu cầu và UAT.

## Tuần 1 (ngày 1–7) – Nền tảng & dữ liệu thật — 25%

- [ ] Workshop 2 giờ với sales/CSKH: luồng chăm sóc hiện tại, phân hạng A/B/C, ai phụ trách khách nào, các loại khiếu nại thường gặp
- [ ] Chốt quy tắc tự động (ngưỡng ngày, chu kỳ mặc định theo nhóm hàng: găng tay ~30 ngày, giày ~180 ngày…) → cấu hình trong trang **Cấu hình**
- [ ] Dev 3: dựng **staging** trên VPS (docker compose), domain `crm-staging…`, HTTPS, backup tự động
- [ ] Xuất danh sách khách hàng + người liên hệ + **lịch sử bán hàng 24 tháng** từ MISA → làm sạch (trùng MST, sai mã, thiếu người phụ trách) → nhập thử trên staging
- [ ] Dev 2: bổ sung trường còn thiếu theo workshop (Prisma migration), rate limit đăng nhập
- [ ] Dev 1: chỉnh danh sách khách hàng/tìm kiếm theo góp ý, thêm sửa thông tin khách trên trang 360°

**Mốc:** staging có dữ liệu thật, 3 người dùng thử đăng nhập được.

## Tuần 2 (ngày 8–14) – Nghiệp vụ CSKH hằng ngày — 50%

- [ ] Customer 360°: chỉnh dòng thời gian, thêm sửa/ẩn người liên hệ đã nghỉ việc, ghi chú nhanh
- [ ] Tasks: giao việc hàng loạt, dời hạn, lọc theo nhóm khách; nhắc việc trên Notifications
- [ ] Ticket: mẫu phân loại khiếu nại PPE (chất lượng, sai size, thiếu CO/CQ, giao trễ), file đính kèm (ảnh lỗi), trạng thái 8D
- [ ] Phân quyền chi tiết theo thực tế (ví dụ: quản lý chỉ thấy team mình)
- [ ] Kiểm thử e2e cho các luồng mới

**Mốc:** nhân viên làm được một ngày chăm sóc khách hoàn toàn trên CRM (staging).

## Tuần 3 (ngày 15–21) – Tự động hóa & phân tích — 75%

- [ ] Hiệu chỉnh Retention Engine trên dữ liệu thật: xem danh sách việc engine tạo, **sales xác nhận đúng/sai** từng việc, chỉnh ngưỡng
- [ ] Đồng bộ đơn hàng định kỳ: CSV theo lịch (thư mục chung / upload hằng ngày) hoặc API MISA AMIS nếu đã xác nhận kết nối được
- [ ] Dashboard: chốt định nghĩa KPI với ban giám đốc, **đo baseline** (tỷ lệ mua lại, thời gian phản hồi khiếu nại) TRƯỚC khi go-live
- [ ] Báo cáo tuần cho quản lý (xuất CSV / email tổng hợp)

**Mốc:** engine tạo việc mà sales đánh giá ≥ 80% là hợp lý.

## Tuần 4 (ngày 22–30) – Đóng băng tính năng, kiểm thử, go-live — 100%

**Từ ngày 22: không thêm tính năng mới.** Chỉ sửa lỗi, chất lượng dữ liệu, bảo mật, hướng dẫn sử dụng.

- [ ] UAT với toàn bộ nhân viên CSKH/sales (kịch bản theo checklist bên dưới)
- [ ] Bảo mật: đổi secret, HTTPS, rate limit, rà soát quyền, xóa tài khoản demo
- [ ] Backup hằng ngày + **thử khôi phục** sang DB khác
- [ ] Giám sát: uptime (`/api/health`), log lỗi (Sentry gói miễn phí)
- [ ] Production: nhập dữ liệu chốt, đào tạo 2 buổi, tài liệu "1 trang" cho nhân viên
- [ ] Bàn giao: tài liệu vận hành, quy trình nhập dữ liệu hằng ngày/tuần

## Checklist go-live (bắt buộc)

- [ ] Đăng nhập và phân quyền theo vai trò hoạt động (nhân viên không xem được khách người khác)
- [ ] Import dữ liệu và đối chiếu trùng khách hàng (theo mã KH, MST)
- [ ] Xem được hồ sơ khách hàng và lịch sử tương tác
- [ ] Tạo, giao việc, hoàn thành và theo dõi việc quá hạn
- [ ] Tiếp nhận ticket và theo dõi tiến độ xử lý, cảnh báo quá SLA
- [ ] Tự động tạo nhiệm vụ cho khách cần chăm sóc (không trùng lặp)
- [ ] Xem dashboard chăm sóc khách hàng
- [ ] Có backup, log lỗi và **đã thử khôi phục dữ liệu**

## Ưu tiên tính năng

| Mức | Nội dung | Trạng thái |
|---|---|---|
| P0 | Customer 360°, Follow-up, Ticket, Automation tạo việc, Dashboard, Phân quyền + audit log | **Có trong bộ khung** – hoàn thiện theo quy trình thật |
| P1 | Phân khúc khách (VIP/mới/nguy cơ/ngủ đông) | **Có trong bộ khung** |
| P1 | Gửi Zalo ZNS / Email tự động (có quản lý đồng ý nhận tin, giới hạn tần suất, log kết quả) | Tháng 2 |
| P1 | Đồng bộ MISA tự động, form web Sapo → lead | Tháng 2 |
| P2 | AI: tóm tắt hội thoại, gợi ý chăm sóc, mô hình dự đoán rời bỏ (huấn luyện trên dữ liệu thật) | Tháng 3+ |

**Không làm trong V1:** chatbot AI, hộp thư đa kênh, workflow kéo-thả, campaign builder phức tạp, app mobile riêng
(giao diện web đã dùng được trên điện thoại).

## Rủi ro & cách kiểm soát

| Rủi ro | Kiểm soát |
|---|---|
| Phạm vi phình to | Đóng băng tính năng ngày 22; mọi yêu cầu mới vào backlog tháng 2 |
| Dữ liệu bẩn (trùng MST, sai mã, thiếu người phụ trách) | Làm sạch tuần 1; import báo lỗi từng dòng; khớp theo mapping → MST → mã KH |
| Nhân viên không dùng | Workshop tuần 1, UAT tuần 4; mỗi sáng chỉ cần mở "Việc cần làm"; quản lý xem bảng hiệu suất hằng tuần |
| Tích hợp MISA mất thời gian | Tháng đầu dùng CSV (đã có); API là P1 sau khi xác nhận khả năng kết nối |
| Automation tạo việc trùng / sai | Idempotency key + 1 việc mở/khách + giới hạn mỗi lần chạy (đã có); sales xác nhận ở tuần 3 |
| Mất dữ liệu | Backup hằng ngày, lưu bản ngoài server, thử khôi phục hằng tháng |
