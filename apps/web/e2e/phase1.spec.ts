import { test, expect, Page } from '@playwright/test';
const unique = (label: string) => `${label}-${Date.now()}`;
async function customer(page: Page, name: string, extra: Record<string, string> = {}) {
  const response = await page.request.post('/api/customers', { data: { code: unique('UI'), name, ...extra } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@dt-crm.local');
  await page.getByLabel('Mật khẩu').fill('Crm@12345');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
});
test('create opportunity, quote, download PDF, follow up and close won', async ({ page }) => {
  const name = unique('UI khách báo giá'),
    title = unique('UI cơ hội');
  const c = await customer(page, name);
  await page.getByRole('link', { name: 'Cơ hội & Báo giá', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm cơ hội' }).click();
  await page.getByLabel('Tìm khách hàng').fill(name);
  await page.getByRole('combobox', { name: 'Khách hàng', exact: true }).selectOption(c.id);
  await page.getByLabel('Tên cơ hội').fill(title);
  await page.getByLabel('Giá trị dự kiến (VND)').fill('1000000');
  await page.getByRole('button', { name: 'Tạo cơ hội', exact: true }).click();
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Lập báo giá', exact: true }).click();
  await page.getByLabel('sku-0', { exact: true }).fill('GLV-UI');
  await page.getByLabel('productName-0', { exact: true }).fill('Găng tay kiểm thử tiếng Việt');
  await page.getByLabel('quantity-0', { exact: true }).fill('100');
  await page.getByLabel('unitPrice-0', { exact: true }).fill('45000');
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
  await expect(page.getByText('Phiên bản 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Bản nháp', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Tải PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await download.failure()).toBeNull();
  await page.getByRole('button', { name: 'Đánh dấu đã gửi' }).click();
  await expect(page.getByText('Đã gửi', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Khách đồng ý', exact: true }).click();
  await expect(page.getByText('Khách đồng ý', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lập phiên bản mới' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/quote-won.png', fullPage: true });
});
test('save a filter, select customers, add a tag and create daily follow-up', async ({ page }) => {
  const name = unique('UI khách hàng loạt'),
    tag = unique('UI-tag'),
    filter = unique('UI-filter'),
    title = unique('UI chăm sóc');
  const c = await customer(page, name);
  await page.goto(`/customers?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lưu bộ lọc hiện tại' }).click();
  await page.getByLabel('Tên bộ lọc').fill(filter);
  await page.getByRole('button', { name: 'Lưu bộ lọc', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Bộ lọc đã lưu').selectOption({ label: filter });
  await page.getByLabel(`Chọn ${c.code}`, { exact: true }).check();
  await page.getByRole('button', { name: 'Thao tác hàng loạt', exact: true }).click();
  await page.getByRole('combobox', { name: 'Thao tác', exact: true }).selectOption('tag');
  await page.getByLabel('Tag (phân cách bằng dấu phẩy)').fill(tag);
  await page.getByRole('button', { name: 'Áp dụng cho danh sách đã chọn' }).click();
  await expect(page.getByRole('status')).toHaveText('Đã xử lý 1 khách hàng.');
  await expect(page.getByText(`#${tag}`, { exact: false })).toBeVisible();
  await page.getByLabel(`Chọn ${c.code}`, { exact: true }).check();
  await page.getByRole('button', { name: 'Thao tác hàng loạt', exact: true }).click();
  await page.getByRole('combobox', { name: 'Thao tác', exact: true }).selectOption('task');
  await page.getByLabel('Tiêu đề công việc').fill(title);
  const now = new Date();
  await page
    .getByLabel('Hạn công việc')
    .fill(new Date(now.getTime() - now.getTimezoneOffset() * 60000 - 60000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Áp dụng cho danh sách đã chọn' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Ngày làm việc', exact: true }).click();
  const task = page
    .locator('div')
    .filter({ has: page.getByText(title, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Ghi kết quả', exact: true }) })
    .last();
  await task.getByRole('button', { name: 'Ghi kết quả' }).click();
  await page.getByRole('textbox').fill('Đã gọi và xác nhận nhu cầu mua lại');
  await page.getByRole('button', { name: 'Lưu kết quả', exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});
test('preview and confirm a duplicate merge from the actual interface', async ({ page }) => {
  const name = unique('UI khách trùng'),
    email = `ui-${Date.now()}@example.test`;
  const a = await customer(page, name, { email }),
    b = await customer(page, `${name} bản hai`, { email });
  await page.goto('/duplicates');
  const card = page
    .locator('div.rounded-xl')
    .filter({ has: page.getByRole('link', { name: `${a.code} · ${a.name}`, exact: true }) })
    .filter({ has: page.getByRole('link', { name: `${b.code} · ${b.name}`, exact: true }) })
    .first();
  await card.getByRole('button', { name: `Giữ ${a.code} · Xem trước`, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const merge = page.getByRole('button', { name: 'Hợp nhất vào hồ sơ chính' });
  await expect(merge).toBeDisabled();
  await page.getByRole('checkbox').check();
  await merge.click();
  await expect(page.getByRole('link', { name: 'Mở hồ sơ chính' })).toBeVisible();
  await page.getByRole('link', { name: 'Mở hồ sơ chính' }).click();
  await expect(page.getByRole('heading', { name: a.name, exact: true })).toBeVisible();
});
test('requires a loss reason when moving a pipeline card to Lost', async ({ page }) => {
  const c = await customer(page, unique('UI khách thua')),
    title = unique('UI deal thua');
  const result = await page.request.post('/api/opportunities', {
    data: {
      customerId: c.id,
      title,
      value: '1000',
      expectedCloseAt: new Date().toISOString().slice(0, 10),
      nextActionAt: new Date().toISOString(),
    },
  });
  expect(result.ok()).toBeTruthy();
  await page.goto('/opportunities');
  await page.getByLabel('Tìm cơ hội').fill(title);
  await page.getByLabel(`Giai đoạn ${title}`).selectOption('LOST');
  await page.getByLabel('Lý do', { exact: true }).fill('Khách chọn nhà cung cấp khác');
  await page.getByRole('button', { name: 'Xác nhận thua' }).click();
  await expect(page.getByLabel(`Giai đoạn ${title}`)).toHaveValue('LOST');
  await expect(page.getByLabel(`Giai đoạn ${title}`)).toBeDisabled();
});
test('shows daily workspace and navigation at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { name: 'Ngày làm việc của tôi' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/workbench-mobile.png', fullPage: true });
});
