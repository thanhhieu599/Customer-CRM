export const SEGMENT: Record<string, { label: string; tone: Tone }> = {
  NEW: { label: 'Khách mới', tone: 'blue' },
  REGULAR: { label: 'Thường xuyên', tone: 'slate' },
  VIP: { label: 'VIP', tone: 'violet' },
  AT_RISK: { label: 'Nguy cơ rời bỏ', tone: 'rose' },
  DORMANT: { label: 'Ngủ đông', tone: 'amber' },
};

export const HEALTH: Record<string, { label: string; tone: Tone }> = {
  HEALTHY: { label: 'Khỏe mạnh', tone: 'emerald' },
  WATCH: { label: 'Cần quan tâm', tone: 'amber' },
  AT_RISK: { label: 'Nguy cơ', tone: 'rose' },
};

export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  LOW: { label: 'Thấp', tone: 'slate' },
  NORMAL: { label: 'Bình thường', tone: 'blue' },
  HIGH: { label: 'Cao', tone: 'amber' },
  URGENT: { label: 'Khẩn', tone: 'rose' },
};

export const TASK_TYPE: Record<string, string> = {
  FOLLOW_UP: 'Chăm sóc',
  CALL: 'Gọi điện',
  REORDER: 'Nhắc đặt lại',
  WIN_BACK: 'Giữ chân',
  POST_DELIVERY: 'Sau giao hàng',
  TICKET: 'Ticket',
  OTHER: 'Khác',
};

export const TASK_STATUS: Record<string, string> = {
  OPEN: 'Chưa làm',
  IN_PROGRESS: 'Đang làm',
  DONE: 'Hoàn thành',
  CANCELED: 'Hủy',
};

export const TICKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  NEW: { label: 'Mới', tone: 'blue' },
  IN_PROGRESS: { label: 'Đang xử lý', tone: 'violet' },
  WAITING_CUSTOMER: { label: 'Chờ khách', tone: 'amber' },
  RESOLVED: { label: 'Đã giải quyết', tone: 'emerald' },
  CLOSED: { label: 'Đóng', tone: 'slate' },
};

export const TICKET_CATEGORY: Record<string, string> = {
  QUALITY: 'Chất lượng',
  DELIVERY: 'Giao hàng',
  DOCUMENT: 'Chứng từ (CO/CQ…)',
  PRICING: 'Giá / công nợ',
  REQUEST: 'Yêu cầu',
  OTHER: 'Khác',
};

export const ACTIVITY_TYPE: Record<string, string> = {
  CALL: 'Cuộc gọi',
  EMAIL: 'Email',
  ZALO: 'Zalo',
  MEETING: 'Họp',
  VISIT: 'Thăm khách',
  NOTE: 'Ghi chú',
  ORDER: 'Đơn hàng',
  TICKET: 'Ticket',
  STATUS_CHANGE: 'Thay đổi',
  SYSTEM: 'Hệ thống',
};

export const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  POSITIVE: { label: 'Tích cực', tone: 'emerald' },
  NEUTRAL: { label: 'Bình thường', tone: 'slate' },
  NEGATIVE: { label: 'Tiêu cực', tone: 'rose' },
  NO_ANSWER: { label: 'Không liên lạc được', tone: 'amber' },
};

export const CONTACT_ROLE: Record<string, string> = {
  PURCHASING: 'Mua hàng',
  EHS: 'EHS / An toàn',
  QA: 'QA / QC',
  WAREHOUSE: 'Kho',
  ADMIN: 'Hành chính',
  PRODUCTION: 'Sản xuất',
  OTHER: 'Khác',
};

export const REORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: 'Theo lịch', tone: 'slate' },
  dueSoon: { label: 'Sắp đến hạn', tone: 'amber' },
  overdue: { label: 'Quá hạn', tone: 'rose' },
  atRisk: { label: 'Nguy cơ mất đơn', tone: 'rose' },
};

export const ROLE: Record<string, string> = { ADMIN: 'Quản trị', MANAGER: 'Quản lý', AGENT: 'Nhân viên CSKH' };

export type Tone = 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose';
