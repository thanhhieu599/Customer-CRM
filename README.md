# Customer Care CRM – MVP V1

CRM lấy **chăm sóc & giữ chân khách hàng** làm trung tâm, cho doanh nghiệp B2B (PPE, MRO, vật tư công nghiệp).
Không chỉ lưu thông tin – hệ thống **chủ động** cho nhân viên biết mỗi ngày:

- Hôm nay cần chăm sóc khách nào? Việc nào đang trễ?
- Khách nào đã quá chu kỳ mua mà chưa quay lại? Mã hàng nào sắp đến kỳ đặt lại?
- Khách nào có nguy cơ rời bỏ – và **vì sao** (điểm sức khỏe giải thích được)?
- Ticket/khiếu nại nào sắp hoặc đã quá SLA?
- Nhân viên nào đang bỏ sót khách? Hoạt động chăm sóc nào thực sự dẫn tới đơn hàng?

| Thành phần | Công nghệ |
|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4|
| Backend | NestJS 11 (modular monolith) + TypeScript |
| Database | PostgreSQL 16 + Prisma ORM 7 |
| Jobs / tự động hóa | Redis + BullMQ (lịch chạy 01:00 hằng ngày, kiểm tra SLA mỗi 15 phút) |
| Triển khai | Docker Compose + Caddy (HTTPS tự động) trên 1 VPS |

## Đã có trong bộ khung (chạy được ngay)

- **Đăng nhập & phân quyền** (Admin / Quản lý / Nhân viên CSKH), kiểm tra quyền ở backend; nhân viên chỉ thấy khách mình phụ trách; **audit log** mọi thao tác.
- **Customer 360°**: hồ sơ, người liên hệ theo vai trò mua hàng (Purchasing / EHS / QA / Kho…), tag, phân hạng A/B/C, dòng thời gian tương tác, đơn hàng, ticket, việc đang mở, **dự báo đặt hàng lại theo mã hàng**, điểm sức khỏe kèm lý do, gợi ý chăm sóc.
- **Follow-up Center**: việc hôm nay / quá hạn / 7 ngày tới; hoàn thành việc **bắt buộc ghi kết quả** → tự ghi vào dòng thời gian.
- **Ticket / khiếu nại** có SLA theo mức ưu tiên (4h / 8h / 24h / 72h), phản hồi đầu tiên, ghi chú nội bộ, cảnh báo quá SLA cho quản lý.
- **Retention Engine** (rule-based, giải thích được) – 6 quy tắc tạo việc cho người, có **idempotency key** chống tạo trùng, giới hạn số việc mỗi lần chạy, tự đóng việc khi khách đã đặt hàng lại.
- **Dashboard KPI**: khách cần chăm sóc, việc quá hạn, tỷ lệ hoàn thành, SLA ticket, thời gian phản hồi, tỷ lệ mua lại (theo tháng), doanh thu mua lại, tỷ lệ kích hoạt lại, tỷ lệ chăm sóc → có đơn, **bảng hiệu suất từng nhân viên**.
- **Nhập CSV** khách hàng & đơn hàng (tiêu đề tiếng Việt kiểu MISA, số `1.234.567`, ngày `DD/MM/YYYY`), chống trùng qua `external_id_mappings`, nhập lại không tạo trùng, nhật ký đồng bộ.
- Kiểm thử: 44 unit test, 29 e2e backend (PostgreSQL + Redis thật), 5 luồng trình duyệt Playwright; đã cấu hình GitHub Actions.

## Chạy trên máy dev (5 phút)

Yêu cầu: Node.js 22, Docker (hoặc PostgreSQL 16 + Redis 7 cài sẵn).

```bash
npm ci
```

```bash
docker compose -f docker-compose.dev.yml up -d
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
npm run prisma:deploy:wasm -w apps/api && npm run db:seed
```

Mở 2 terminal:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Truy cập http://localhost:3000 – tài khoản mẫu (mật khẩu `Crm@12345`):

| Email | Vai trò |
|---|---|
| `admin@dt-crm.local` | Quản trị |
| `quanly@dt-crm.local` | Quản lý CSKH |
| `sale1@dt-crm.local`, `sale2@dt-crm.local` | Nhân viên CSKH |

Dữ liệu mẫu là **công ty hư cấu** có kịch bản: khách đặt đều mỗi tháng, khách VIP ngừng đặt 80+ ngày, khách ngủ đông, khách mới, khiếu nại quá SLA. Vào **Tổng quan → "Chạy phân tích ngay"** để engine tạo việc.

## Cấu trúc

```
apps/
  api/                    NestJS
    prisma/schema.prisma  18 bảng: users, customers, customer_contacts, customer_tags, orders, order_items,
                          activities, tasks, tickets, ticket_comments, automation_rules, automation_executions,
                          notifications, external_id_mappings, sync_logs, audit_logs …
    src/retention/        Retention Engine (domain/ = thuật toán thuần, có unit test)
    src/imports/          Nhập CSV (MISA / Excel)
    test/                 e2e
  web/                    Next.js (app/(app)/… các trang, components/ui = shadcn-style)
deploy/                   Caddyfile, script backup
docs/                     Kiến trúc, lộ trình 30 ngày, triển khai, KPI, mẫu CSV
```




## Đợt 1 — Sales / CSKH

Đã bổ sung pipeline cơ hội, báo giá nhiều phiên bản có PDF tiếng Việt và nhắc theo dõi,
trang ngày làm việc, bộ lọc riêng/thao tác khách hàng hàng loạt và xem trước hợp nhất khách trùng.
Xem [quy tắc nghiệp vụ, phân quyền và cách kiểm thử](docs/DOT-1-SALES-CSKH.md).
