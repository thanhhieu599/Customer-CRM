# Kiến trúc

## Tổng thể

```
Trình duyệt ──HTTPS──► Caddy ──► Next.js (web, :3000)
                                   │  /api/* rewrite (cùng domain → cookie httpOnly, không CORS)
                                   ▼
                              NestJS (api, :4000) ── modular monolith
                              ├─ auth, users, audit
                              ├─ customers (360°), orders, activities
                              ├─ tasks (follow-up), tickets (SLA)
                              ├─ retention (engine + BullMQ worker/scheduler)
                              ├─ imports (CSV MISA/Excel), dashboard, notifications
                              │
                    PostgreSQL 16 ◄┘└► Redis 7 (BullMQ: lịch 01:00 & SLA 15 phút)
```

**Modular monolith, không microservices**: 1 backend, chia module độc lập. Với team 3 người: một lần deploy,
một database, transaction đơn giản, debug dễ. Khi cần tách (ví dụ worker riêng), chạy thêm 1 instance API với
`SCHEDULER_ENABLED=true` và tắt ở instance còn lại – không phải sửa code.

## Quyết định quan trọng

| Quyết định | Lý do |
|---|---|
| `customers` là công ty; người liên hệ ở `customer_contacts` với **vai trò mua hàng** (Purchasing, EHS, QA, Kho…) | Khách B2B/FDI có nhiều người ảnh hưởng quyết định. Khi người phụ trách nghỉ việc (`left_company_at`), quan hệ không mất. |
| `external_id_mappings (system, entity_type, external_id)` | Cùng một khách có mã khác nhau trên MISA / Sapo / CSV. **Không dùng số điện thoại làm khóa.** Thứ tự khớp: mapping → MST → mã KH. |
| `activities` là dòng thời gian duy nhất | Cuộc gọi, Zalo, thăm khách, đơn hàng, ticket, đổi trạng thái đều ghi vào đây → Customer 360° chỉ đọc một nguồn. |
| Hoàn thành việc **bắt buộc nhập kết quả** | Không có kết quả thì không đo được "chăm sóc nào dẫn tới mua lại". |
| `automation_executions.idempotency_key` UNIQUE, tạo trong cùng transaction với task | Engine chạy lại, chạy song song hay retry đều **không tạo việc trùng**. Lỗi được ghi `FAILED` kèm thông báo. |
| Mỗi khách chỉ có **1 việc tự động đang mở** | Tránh dồn việc cho nhân viên; quy tắc bị bỏ qua sẽ được xét lại khi việc cũ đóng. |
| `maxTasksPerRun` cho từng quy tắc | Lần nhập 2 năm dữ liệu đầu tiên không đổ hàng trăm việc một lúc; ưu tiên khách doanh thu cao. |
| V1 chỉ **tạo việc cho người**, không tự gửi tin cho khách | Tránh gửi sai thời điểm/trùng/phiền khách. Gửi Zalo/Email tự động là P1, cần quản lý đồng ý nhận tin (`marketing_consent`, `marketing_opt_out`) và giới hạn tần suất. |
| Health score **rule-based** | Dễ giải thích cho sales ("vì sao khách này đỏ"), dễ kiểm chứng. Hiệu chỉnh trọng số sau 2–3 tháng dữ liệu thật; ML là P2. |
| Ngày tháng theo **giờ Việt Nam** (`TZ_BUSINESS`) | "Hôm nay", lịch 01:00, hạn 17:00 đều theo giờ VN dù server chạy UTC. |
| Phân quyền kiểm tra ở **backend** | Frontend chỉ ẩn/hiện; mọi API đều kiểm tra role + quyền sở hữu khách. |

## Bảo mật (đã có / cần làm trước khi đưa dữ liệu thật)

Đã có: mật khẩu bcrypt; JWT trong cookie `httpOnly`, `SameSite=Lax`, `Secure` khi chạy HTTPS; khóa tài khoản có hiệu lực
ngay (guard đọc lại user mỗi request); validate mọi input (class-validator, whitelist); helmet; audit log; secret qua biến môi trường.

Cần làm trong tuần 4 (xem checklist go-live): đổi toàn bộ secret, giới hạn số lần đăng nhập sai (rate limit),
backup + **thử khôi phục**, giám sát lỗi (Sentry), chính sách mật khẩu, rà soát quyền theo thực tế phòng ban.
