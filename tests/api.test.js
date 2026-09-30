'use strict';

/**
 * اختبارات واجهة الـ API — تعمل على قاعدة SQLite مؤقتة.
 * التشغيل: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TEST_DB = path.join(os.tmpdir(), `sharq-test-${Date.now()}.db`);

process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_PATH = TEST_DB;
process.env.SECRET_KEY = 'test-secret-key-please-change';
process.env.DEFAULT_ADMIN_PASSWORD = 'admin123';

const { app } = require('../server');
const { db } = require('../src/db');

let server;
let baseUrl;
let token;

async function call(pathname, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, body });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, body: payload, headers: response.headers };
}

test.before(async () => {
  await db.init();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${TEST_DB}${suffix}`)) fs.unlinkSync(`${TEST_DB}${suffix}`);
  }
});

test('الصحة: /api/health يعمل', async () => {
  const { status, body } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'sqlite');
});

test('منيو الزائر: يرجع المطعم والفئات العربية', async () => {
  const { status, body } = await call('/api/menu/1?table=2');
  assert.equal(status, 200);
  assert.equal(body.restaurant.name, 'طعم الشرق');
  assert.equal(body.restaurant.currency, 'SAR');
  assert.equal(body.table.number, 2);
  assert.ok(body.categories.length >= 4, 'يجب أن تحتوي بيانات العينة على 4 فئات على الأقل');
  assert.ok(body.categories[0].items.length > 0, 'الفئة الأولى يجب أن تحتوي أطباقاً');
  assert.equal(typeof body.categories[0].items[0].price, 'number');
  assert.equal(body.restaurant.admin_password_hash, undefined, 'لا يجب إرجاع بصمة كلمة المرور');
});

test('منيو الزائر: مطعم غير موجود يرجع 404', async () => {
  const { status } = await call('/api/menu/9999');
  assert.equal(status, 404);
});

test('تسجيل الدخول: مطلوب كلمة مرور صحيحة', async () => {
  const wrong = await call('/api/admin/login', {
    method: 'POST',
    body: { password: 'wrong-password' },
  });
  assert.equal(wrong.status, 401);

  const right = await call('/api/admin/login', {
    method: 'POST',
    body: { password: 'admin123' },
  });
  assert.equal(right.status, 200);
  assert.ok(right.body.token, 'يجب إرجاع توكن');
  token = right.body.token;
});

test('المسارات الإدارية محمية بالتوكن', async () => {
  const { status } = await call('/api/admin/menu');
  assert.equal(status, 401);

  const bad = await call('/api/admin/menu', { token: 'not-a-real-token' });
  assert.equal(bad.status, 403);
});

test('إضافة فئة ثم تعديلها ثم حذفها', async () => {
  const created = await call('/api/admin/categories', {
    method: 'POST',
    token,
    body: { name: 'عصائر طازجة', description: 'مشروبات باردة' },
  });
  assert.equal(created.status, 201);
  const categoryId = created.body.category.id;
  assert.equal(created.body.category.is_visible, true);

  const updated = await call(`/api/admin/categories/${categoryId}`, {
    method: 'PUT',
    token,
    body: { name: 'عصائر ومشروبات', isVisible: false },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.category.name, 'عصائر ومشروبات');
  assert.equal(updated.body.category.is_visible, false);

  const hidden = await call('/api/menu/1');
  assert.equal(
    hidden.body.categories.some((category) => category.id === categoryId),
    false,
    'الفئة المخفية يجب ألا تظهر للزوار'
  );

  const removed = await call(`/api/admin/categories/${categoryId}`, { method: 'DELETE', token });
  assert.equal(removed.status, 200);
});

test('إدارة الأطباق: إضافة مع صورة، تعديل السعر، إخفاء، حذف', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
    'base64'
  );

  const form = new FormData();
  form.append('categoryId', '1');
  form.append('name', 'شاورما لحم');
  form.append('description', 'شاورما لحم بالطحينة');
  form.append('price', '42.5');
  form.append('image', new Blob([png], { type: 'image/png' }), 'dish.png');

  const created = await call('/api/admin/menu-items', { method: 'POST', token, body: form });
  assert.equal(created.status, 201);
  const itemId = created.body.item.id;
  assert.equal(created.body.item.price, 42.5);
  assert.match(created.body.item.image_url, /^\/uploads\//);

  const publicMenu = await call('/api/menu/1');
  const appetizers = publicMenu.body.categories.find((category) => category.id === 1);
  assert.ok(appetizers.items.some((item) => item.name === 'شاورما لحم'));

  const updated = await call(`/api/admin/menu-items/${itemId}`, {
    method: 'PUT',
    token,
    body: { price: 49, available: false },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.price, 49);
  assert.equal(updated.body.item.available, false);

  const afterHide = await call('/api/menu/1');
  const hiddenItems = afterHide.body.categories.find((category) => category.id === 1).items;
  assert.equal(hiddenItems.some((item) => item.id === itemId), false, 'الطبق غير المتاح يجب إخفاؤه');

  const preview = await call('/api/menu/1?preview=1', { token });
  assert.equal(preview.body.preview, true);
  assert.ok(
    preview.body.categories.some((category) => category.items.some((item) => item.id === itemId)),
    'وضع المعاينة يجب أن يعرض الأطباق غير المتاحة'
  );

  const removed = await call(`/api/admin/menu-items/${itemId}`, { method: 'DELETE', token });
  assert.equal(removed.status, 200);
});

test('رفض الأسعار غير الصحيحة', async () => {
  const { status, body } = await call('/api/admin/menu-items', {
    method: 'POST',
    token,
    body: { categoryId: 1, name: 'طبق خاطئ', price: '-5' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /السعر/);
});

test('الطاولات: إضافة، منع التكرار، توليد QR، حذف', async () => {
  const created = await call('/api/admin/tables', {
    method: 'POST',
    token,
    body: { tableNumber: 77 },
  });
  assert.equal(created.status, 201);
  assert.match(created.body.table.url, /\/menu\/1\?table=77$/);
  assert.match(created.body.table.qr, /^data:image\/png;base64,/);

  const duplicate = await call('/api/admin/tables', {
    method: 'POST',
    token,
    body: { tableNumber: 77 },
  });
  assert.equal(duplicate.status, 409);

  const list = await call('/api/admin/tables', { token });
  assert.ok(list.body.some((table) => table.table_number === 77));

  const png = await call('/api/menu/1/qr?table=77&format=png');
  assert.equal(png.status, 200);
  assert.match(png.headers.get('content-type'), /image\/png/);

  const removed = await call(`/api/admin/tables/${created.body.table.id}`, {
    method: 'DELETE',
    token,
  });
  assert.equal(removed.status, 200);
});

test('إعدادات المطعم: تحديث الاسم والعملة', async () => {
  const { status, body } = await call('/api/admin/restaurant', {
    method: 'PUT',
    token,
    body: { name: 'طعم الشرق — فرع الرياض', currency: 'AED' },
  });
  assert.equal(status, 200);
  assert.equal(body.restaurant.name, 'طعم الشرق — فرع الرياض');
  assert.equal(body.restaurant.currency, 'AED');

  await call('/api/admin/restaurant', {
    method: 'PUT',
    token,
    body: { name: 'طعم الشرق', currency: 'SAR' },
  });
});

test('تغيير كلمة المرور يعمل', async () => {
  const changed = await call('/api/admin/password', {
    method: 'PUT',
    token,
    body: { currentPassword: 'admin123', newPassword: 'strong-pass-1' },
  });
  assert.equal(changed.status, 200);

  const oldPassword = await call('/api/admin/login', {
    method: 'POST',
    body: { password: 'admin123' },
  });
  assert.equal(oldPassword.status, 401);

  const newPassword = await call('/api/admin/login', {
    method: 'POST',
    body: { password: 'strong-pass-1' },
  });
  assert.equal(newPassword.status, 200);

  const revert = await call('/api/admin/password', {
    method: 'PUT',
    token: newPassword.body.token,
    body: { currentPassword: 'strong-pass-1', newPassword: 'admin123' },
  });
  assert.equal(revert.status, 200);
});

test('صفحات الواجهة تُخدَم بشكل صحيح', async () => {
  const home = await call('/');
  assert.equal(home.status, 200);

  const menuPage = await call('/menu/1');
  assert.equal(menuPage.status, 200);

  const adminPage = await call('/admin.html');
  assert.equal(adminPage.status, 200);

  const missing = await call('/no-such-page');
  assert.equal(missing.status, 404);
});
