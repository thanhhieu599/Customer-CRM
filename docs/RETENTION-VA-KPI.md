# Retention Engine, Health Score & KPI

## Retention Engine

Chạy **01:00 mỗi ngày** (giờ VN) và khi quản lý bấm "Chạy phân tích ngay" hoặc sau khi nhập đơn hàng. Mỗi lần chạy:

1. Tính lại cho từng khách: số đơn, doanh thu 12 tháng & 12 tháng trước, lần mua gần nhất, **chu kỳ mua**, health score, phân khúc.
2. Tự đóng việc "giữ chân / nhắc đặt lại" nếu khách đã đặt đơn sau khi việc được tạo (ghi kết quả tự động).
3. Áp dụng các quy tắc theo thứ tự ưu tiên. Mỗi khách nhận tối đa **1 việc tự động mới mỗi lần chạy** và chỉ khi chưa có việc tự động đang mở.

| Quy tắc (key) | Điều kiện kích hoạt | Việc tạo ra | Khóa chống trùng |
|---|---|---|---|
| `health-at-risk` | Khách vừa chuyển sang mức **Nguy cơ** | Giữ chân, Khẩn, hạn 2 ngày, kèm lý do | khách + ngày |
| `no-order-for-cycle` | Số ngày chưa mua ≥ max(21, chu kỳ × 1,3) và ≤ 365 | Gọi hỏi nhu cầu, Cao/Khẩn | khách + ngày đơn gần nhất |
| `reorder-due` | Mã hàng sắp đến kỳ (≤ 7 ngày) hoặc đã quá kỳ; độ tin cậy ≥ medium | Nhắc đặt lại, liệt kê mã hàng + SL gợi ý | khách + tập mã hàng/ngày dự kiến |
| `vip-no-contact` | Khách VIP không có tương tác chăm sóc ≥ 30 ngày | Chăm sóc VIP | khách + ngày tương tác gần nhất |
| `post-delivery` | Đơn đã giao 3 ngày, giá trị ≥ 20 triệu | Hỏi thăm sau giao (chất lượng, size, CO/CQ) | mã đơn |
| `ticket-sla-breach` (mỗi 15 phút) | Ticket chưa phản hồi, quá hạn SLA | Việc Khẩn cho người xử lý + thông báo quản lý | ticket |

Mọi ngưỡng chỉnh được trong trang **Cấu hình** (admin). `maxTasksPerRun` giới hạn số việc mỗi lần chạy; việc bị giới hạn
sẽ được tạo ở lần chạy sau (ưu tiên khách doanh thu cao).

### Chu kỳ mua được tính thế nào

- **Theo mã hàng**: trung vị 6 khoảng cách gần nhất giữa các lần mua mã đó (bền với 1 lần đặt bất thường). Độ tin cậy:
  *high* khi ≥ 3 khoảng và độ lệch ≤ 25%; *medium* khi độ lệch ≤ 50%.
- **Theo khách**: chu kỳ ngắn nhất trong các mã hàng mua đều (≥ 3 lần, lần cuối trong 12 tháng). Lý do: khách FDI
  thường đặt các mã khác nhau vào các ngày lệch nhau. Lấy khoảng cách giữa các đơn bất kỳ sẽ đánh giá chu kỳ quá ngắn
  và nhắc quá sớm. Nếu khách không có mã hàng mua đều, hệ thống gộp các đơn cách nhau dưới 7 ngày thành một lần mua.

## Health Score (0–100)

| Thành phần | Điểm tối đa | Cách tính |
|---|---|---|
| Mua đúng chu kỳ | 35 | Đủ điểm nếu chưa quá chu kỳ; giảm tuyến tính về 0 khi đạt 2 lần chu kỳ |
| Xu hướng doanh thu | 20 | 12 tháng gần nhất so với 12 tháng trước: tăng ≥ 10% được 20 điểm, giảm ≥ 30% được 0 điểm |
| Khiếu nại | 20 | 0 ticket mở: 20 · 1 ticket: 12 · 2 ticket: 6 · từ 3 ticket: 0; trừ 5 điểm cho mỗi ticket quá SLA |
| Công nợ (từ MISA) | 15 | Không quá hạn: 15 · ≤ 15 ngày: 10 · ≤ 30 ngày: 5 · trên 30 ngày: 0 |
| Tương tác 30 ngày | 10 | Có tương tác tích cực: 10 · có tương tác: 5 · không có: 0 |

Mức đánh giá: **≥ 70 Khỏe mạnh · 40–69 Cần quan tâm · < 40 Nguy cơ**. Quy tắc ghi đè: khách đã bỏ lỡ từ 2 chu kỳ trở lên
thì luôn ở mức Nguy cơ, dù doanh thu trước đó cao. Mỗi điểm số đều kèm **lý do bằng tiếng Việt** hiển thị cho sales.

Đây là công thức quy tắc, **chưa phải mô hình dự đoán đã kiểm chứng**. Sau 2–3 tháng, so sánh điểm số với việc khách
có thực sự ngừng mua hay không, rồi hiệu chỉnh trọng số (`apps/api/src/retention/domain/health-score.ts` có unit test).

## Phân khúc

Mỗi khách thuộc một phân khúc, xét theo thứ tự: **Ngủ đông** (không mua quá max(180 ngày, 3 chu kỳ)) → **Nguy cơ**
(health ở mức Nguy cơ) → **VIP** (hạng A hoặc doanh thu 12 tháng ≥ 500 triệu) → **Mới** (đơn đầu trong 90 ngày) → **Thường xuyên**.

## Định nghĩa KPI (Dashboard)

| KPI | Định nghĩa |
|---|---|
| Khách cần chăm sóc hôm nay | Số khách có việc đang mở với hạn đến hết hôm nay |
| Task Completion Rate | Số việc đến hạn trong kỳ đã hoàn thành / tổng số việc đến hạn trong kỳ (không tính việc đã hủy) |
| Overdue Follow-up Rate | Số việc đang mở đã quá hạn / tổng số việc đang mở |
| First Response Time | Thời gian trung bình từ lúc tạo ticket đến lần phản hồi khách đầu tiên (ghi chú nội bộ không tính) |
| Ticket SLA Compliance | Số ticket phản hồi trước hạn SLA / số ticket đã phản hồi hoặc đã quá hạn |
| Repeat Purchase Rate | Trong số khách đã mua ở 12 tháng trước kỳ, tỷ lệ khách có đơn trong kỳ |
| Repeat Purchase Revenue | Doanh thu trong kỳ từ những khách đã từng mua trước kỳ |
| Reactivation Rate | Số khách có đơn trong kỳ sau khi ngưng mua hơn 180 ngày / (số khách đó + số khách đang ngủ đông) |
| Chăm sóc → có đơn | Tỷ lệ việc "giữ chân / nhắc đặt lại" tạo trong kỳ mà khách đặt đơn trong vòng 14 ngày sau đó |

**Lưu ý đo lường:** đo **baseline trước khi go-live** (chạy dashboard trên dữ liệu lịch sử). Tỷ lệ hoàn thành việc
**không phải** bằng chứng trực tiếp rằng giữ được khách. Hãy so sánh tỷ lệ mua lại và tỷ lệ "chăm sóc → có đơn" trước và
sau khi áp dụng CRM, phân tích riêng theo nhóm khách mua theo chu kỳ.
