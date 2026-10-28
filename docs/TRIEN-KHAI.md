# Triển khai production

## 1. Vì sao không dùng được shared hosting

Shared hosting (cPanel, gói hosting PHP + MySQL) được thiết kế cho website PHP chạy theo từng request. Hệ thống này cần:

| Cần | Shared hosting |
|---|---|
| Tiến trình Node.js chạy liên tục (API + worker chạy lịch 01:00, SLA mỗi 15 phút) | Không (hoặc bị tắt khi không có request) |
| PostgreSQL | Thường chỉ có MySQL |
| Redis (hàng đợi BullMQ) | Không |
| Docker | Không |

→ **Giữ website `trangthietbi.vn` trên Sapo như hiện tại**, CRM chạy riêng ở subdomain `crm.trangthietbi.vn`
(chỉ cần thêm 1 bản ghi DNS trỏ về máy chủ CRM).

## 2. Các phương án hosting (giá tham khảo, cần kiểm tra lại khi mua)

| Phương án | Chi phí tham khảo/tháng | Ưu | Nhược |
|---|---|---|---|
| **A. 1 VPS tại Việt Nam** (2 vCPU, 4 GB RAM, 60 GB SSD) – chạy `docker compose` | ~300.000–800.000đ | Rẻ, dữ liệu ở VN, toàn quyền | Team tự vận hành (cập nhật, backup) |
| B. Dịch vụ cloud được quản lý: Postgres (Neon/Supabase), Redis (Upstash), API (Render/Railway), Web (Vercel) | Có gói miễn phí để thử; production ~20–60 USD | Ít việc vận hành | Dữ liệu ở nước ngoài, nhiều nhà cung cấp |

**Khuyến nghị: phương án A** cho 3 người vận hành. Dữ liệu khách hàng và người liên hệ là dữ liệu cá nhân.
Nếu đặt máy chủ ở nước ngoài (phương án B), cần xem xét quy định bảo vệ dữ liệu cá nhân của Việt Nam (Nghị định 13/2023/NĐ-CP
và Luật Bảo vệ dữ liệu cá nhân) về chuyển dữ liệu ra nước ngoài. Hãy xác nhận với tư vấn pháp lý.

## 3. Cài đặt trên VPS (Ubuntu 24.04)

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
git clone https://github.com/thanhhieu599/Customer-CRM.git /opt/crm && cd /opt/crm
```

```bash
cp .env.example .env && nano .env
```

Trong `.env`: đặt `CRM_DOMAIN`, `POSTGRES_PASSWORD` mạnh, `JWT_SECRET` (tạo bằng `openssl rand -hex 32`).
DNS: tạo bản ghi `A crm → IP của VPS` (tại nơi quản lý tên miền), mở cổng 80/443.

```bash
docker compose up -d --build
```

Caddy tự xin chứng chỉ HTTPS. API tự chạy migration khi khởi động.

Tạo tài khoản admin đầu tiên (một lần, rồi đổi mật khẩu ngay trong trang Cấu hình):

```bash
docker compose exec api npx ts-node --transpile-only prisma/seed.ts
```

> Lệnh seed tạo thêm **dữ liệu mẫu**. Với production thật, sau khi tạo admin hãy khóa các tài khoản demo và xóa
> khách hàng mã `DEMO-*`, hoặc tạo admin bằng SQL/API thay vì seed.

### Backup

```bash
crontab -e
```

Thêm dòng: `15 2 * * * /opt/crm/deploy/backup.sh >> /var/log/crm-backup.log 2>&1`, rồi đồng bộ thư mục backup ra ngoài
(Google Drive/S3 bằng `rclone`). **Mỗi tháng thử khôi phục** một bản backup vào DB tạm.

### Cập nhật phiên bản

```bash
cd /opt/crm && git pull && docker compose up -d --build
```

## 4. Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Kết nối PostgreSQL |
| `REDIS_URL` | Kết nối Redis (BullMQ) |
| `JWT_SECRET` | Bí mật ký token – bắt buộc đổi |
| `COOKIE_SECURE` | `true` khi chạy HTTPS |
| `TZ_BUSINESS` | Múi giờ nghiệp vụ, mặc định `Asia/Ho_Chi_Minh` |
| `SCHEDULER_ENABLED` | `false` để tắt lịch chạy tự động trên instance phụ |
| `API_URL` (web) | Địa chỉ API mà Next.js chuyển tiếp `/api/*`. **Được ghi vào lúc build** – đổi thì build lại web |

## 5. Giám sát

- Uptime: kiểm tra `https://crm.<domain>/api/health` mỗi 5 phút (UptimeRobot, Better Stack… gói miễn phí).
- Log: `docker compose logs -f api`.
- Engine: trang **Cấu hình** hiển thị số lần chạy của từng quy tắc; API `GET /api/retention/executions` cho chi tiết (gồm lỗi).
