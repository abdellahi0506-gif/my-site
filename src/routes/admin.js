'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { asyncHandler, HttpError } = require('../utils/http-error');
const { authenticateToken, signToken } = require('../middleware/auth');
const { upload, removeUploadedFile, toPublicUrl } = require('../middleware/upload');
const { buildTableLink, toDataUrl } = require('../utils/qr');
const { resolveBaseUrl } = require('../utils/base-url');
const { toText, toId, toPrice, toOrder, toBool, toCurrency } = require('../utils/validate');
const {
  mapRestaurant,
  mapCategory,
  mapItem,
  mapTable,
  isDuplicateError,
} = require('../utils/mappers');

const router = express.Router();

// ------------------------------------------------------------------
// حماية بسيطة ضد محاولات تخمين كلمة المرور
// ------------------------------------------------------------------
const loginAttempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function registerFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, first: now };
  if (now - entry.first > WINDOW_MS) {
    entry.count = 0;
    entry.first = now;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
}

function isBlocked(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

// ------------------------------------------------------------------
// تسجيل الدخول
// ------------------------------------------------------------------
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const key = `${req.ip}:${req.body && req.body.restaurantId ? req.body.restaurantId : 'any'}`;
    if (isBlocked(key)) {
      throw new HttpError(429, 'محاولات دخول كثيرة، جرّب مرة أخرى بعد قليل');
    }

    const password = req.body ? req.body.password : null;
    if (!password) throw new HttpError(400, 'كلمة المرور مطلوبة');

    const restaurant = req.body.restaurantId
      ? await db.get('SELECT * FROM restaurants WHERE id = ?', [toId(req.body.restaurantId, 'المطعم')])
      : await db.get('SELECT * FROM restaurants ORDER BY id LIMIT 1');

    if (!restaurant) {
      registerFailure(key);
      throw new HttpError(401, 'بيانات الدخول غير صحيحة');
    }

    let isValid = false;
    try {
      isValid = await bcrypt.compare(String(password), restaurant.admin_password_hash || '');
    } catch (_) {
      isValid = false;
    }

    if (!isValid) {
      registerFailure(key);
      throw new HttpError(401, 'بيانات الدخول غير صحيحة');
    }

    loginAttempts.delete(key);
    res.json({
      token: signToken(restaurant.id),
      restaurantId: restaurant.id,
      restaurant: mapRestaurant(restaurant),
    });
  })
);

// كل ما يلي يحتاج توكن صالح
router.use(authenticateToken);

/** يجلب بيانات مطعم المستخدم الحالي */
async function currentRestaurant(req) {
  const restaurant = await db.get('SELECT * FROM restaurants WHERE id = ?', [req.restaurantId]);
  if (!restaurant) throw new HttpError(404, 'المطعم غير موجود');
  return restaurant;
}

/** يتأكد أن الفئة تتبع مطعم المستخدم */
async function ownedCategory(categoryId, restaurantId) {
  const category = await db.get(
    'SELECT * FROM categories WHERE id = ? AND restaurant_id = ?',
    [categoryId, restaurantId]
  );
  if (!category) throw new HttpError(404, 'الفئة غير موجودة');
  return category;
}

/** يتأكد أن الطبق يتبع مطعم المستخدم */
async function ownedItem(itemId, restaurantId) {
  const item = await db.get(
    `SELECT mi.* FROM menu_items mi
       JOIN categories c ON c.id = mi.category_id
      WHERE mi.id = ? AND c.restaurant_id = ?`,
    [itemId, restaurantId]
  );
  if (!item) throw new HttpError(404, 'الطبق غير موجود');
  return item;
}

// =============== بيانات المطعم ===============

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const restaurant = await currentRestaurant(req);
    res.json({ restaurant: mapRestaurant(restaurant) });
  })
);

router.get(
  '/restaurant',
  asyncHandler(async (req, res) => {
    const restaurant = await currentRestaurant(req);
    res.json(mapRestaurant(restaurant));
  })
);

router.put(
  '/restaurant',
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    const restaurant = await currentRestaurant(req);
    const body = req.body || {};

    const name = toText(body.name === undefined ? restaurant.name : body.name, {
      field: 'اسم المطعم',
      required: true,
      max: 255,
    });
    const description = toText(
      body.description === undefined ? restaurant.description : body.description,
      { field: 'الوصف', max: 5000 }
    );
    const phone = toText(body.phone === undefined ? restaurant.phone : body.phone, {
      field: 'رقم الهاتف',
      max: 20,
    });
    const email = toText(body.email === undefined ? restaurant.email : body.email, {
      field: 'البريد الإلكتروني',
      max: 255,
    });
    const address = toText(body.address === undefined ? restaurant.address : body.address, {
      field: 'العنوان',
      max: 500,
    });
    const currency = toCurrency(
      body.currency === undefined ? restaurant.currency : body.currency
    );

    let logoUrl = restaurant.logo_url;
    if (req.file) {
      removeUploadedFile(restaurant.logo_url);
      logoUrl = toPublicUrl(req.file.filename);
    } else if (body.logoUrl === '') {
      removeUploadedFile(logoUrl);
      logoUrl = null;
    }

    await db.run(
      `UPDATE restaurants
          SET name = ?, description = ?, phone = ?, email = ?, address = ?, currency = ?, logo_url = ?
        WHERE id = ?`,
      [name, description, phone, email, address, currency, logoUrl, req.restaurantId]
    );

    const updated = await currentRestaurant(req);
    res.json({ success: true, restaurant: mapRestaurant(updated) });
  })
);

router.put(
  '/password',
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      throw new HttpError(400, 'كلمة المرور الحالية والجديدة مطلوبتان');
    }
    if (String(newPassword).length < 6) {
      throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
    }

    const restaurant = await currentRestaurant(req);
    let isValid = false;
    try {
      isValid = await bcrypt.compare(String(currentPassword), restaurant.admin_password_hash || '');
    } catch (_) {
      isValid = false;
    }
    if (!isValid) throw new HttpError(401, 'كلمة المرور الحالية غير صحيحة');

    const hash = await bcrypt.hash(String(newPassword), 10);
    await db.run('UPDATE restaurants SET admin_password_hash = ? WHERE id = ?', [
      hash,
      req.restaurantId,
    ]);

    res.json({ success: true });
  })
);

// =============== الإحصائيات ===============

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const restaurantId = req.restaurantId;
    const categories = await db.get(
      'SELECT COUNT(*) AS total FROM categories WHERE restaurant_id = ?',
      [restaurantId]
    );
    const items = await db.get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN mi.available = 1 THEN 1 ELSE 0 END) AS available
         FROM menu_items mi
         JOIN categories c ON c.id = mi.category_id
        WHERE c.restaurant_id = ?`,
      [restaurantId]
    );
    const tables = await db.get('SELECT COUNT(*) AS total FROM tables WHERE restaurant_id = ?', [
      restaurantId,
    ]);

    res.json({
      categories: Number(categories.total || 0),
      items: Number(items.total || 0),
      availableItems: Number(items.available || 0),
      hiddenItems: Number(items.total || 0) - Number(items.available || 0),
      tables: Number(tables.total || 0),
    });
  })
);

// =============== الفئات ===============

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT c.*, (SELECT COUNT(*) FROM menu_items mi WHERE mi.category_id = c.id) AS items_count
         FROM categories c
        WHERE c.restaurant_id = ?
        ORDER BY c.display_order, c.id`,
      [req.restaurantId]
    );
    res.json(
      rows.map((row) => ({ ...mapCategory(row), items_count: Number(row.items_count || 0) }))
    );
  })
);

router.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const { name, description, displayOrder, isVisible } = req.body || {};
    const cleanName = toText(name, { field: 'اسم الفئة', required: true, max: 255 });
    const cleanDescription = toText(description, { field: 'الوصف', max: 2000 });

    let order = toOrder(displayOrder, null);
    if (order === null) {
      const last = await db.get(
        'SELECT MAX(display_order) AS max_order FROM categories WHERE restaurant_id = ?',
        [req.restaurantId]
      );
      order = Number(last && last.max_order ? last.max_order : 0) + 1;
    }

    const result = await db.run(
      `INSERT INTO categories (restaurant_id, name, description, display_order, is_visible)
       VALUES (?, ?, ?, ?, ?)`,
      [req.restaurantId, cleanName, cleanDescription, order, toBool(isVisible, true) ? 1 : 0]
    );

    const created = await db.get('SELECT * FROM categories WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, category: mapCategory(created) });
  })
);

router.put(
  '/categories/:categoryId',
  asyncHandler(async (req, res) => {
    const category = await ownedCategory(toId(req.params.categoryId), req.restaurantId);
    const body = req.body || {};

    const name = toText(body.name === undefined ? category.name : body.name, {
      field: 'اسم الفئة',
      required: true,
      max: 255,
    });
    const description = toText(
      body.description === undefined ? category.description : body.description,
      { field: 'الوصف', max: 2000 }
    );
    const displayOrder = toOrder(
      body.displayOrder === undefined ? category.display_order : body.displayOrder,
      Number(category.display_order || 0)
    );
    const isVisible = toBool(
      body.isVisible === undefined ? Boolean(Number(category.is_visible)) : body.isVisible,
      true
    );

    await db.run(
      `UPDATE categories
          SET name = ?, description = ?, display_order = ?, is_visible = ?
        WHERE id = ? AND restaurant_id = ?`,
      [name, description, displayOrder, isVisible ? 1 : 0, category.id, req.restaurantId]
    );

    const updated = await db.get('SELECT * FROM categories WHERE id = ?', [category.id]);
    res.json({ success: true, category: mapCategory(updated) });
  })
);

router.delete(
  '/categories/:categoryId',
  asyncHandler(async (req, res) => {
    const category = await ownedCategory(toId(req.params.categoryId), req.restaurantId);

    const items = await db.all('SELECT image_url FROM menu_items WHERE category_id = ?', [
      category.id,
    ]);

    await db.withTransaction(async (tx) => {
      await tx.run('DELETE FROM menu_items WHERE category_id = ?', [category.id]);
      await tx.run('DELETE FROM categories WHERE id = ? AND restaurant_id = ?', [
        category.id,
        req.restaurantId,
      ]);
    });

    items.forEach((item) => removeUploadedFile(item.image_url));
    res.json({ success: true });
  })
);

// =============== المنيو (لوحة التحكم) ===============

router.get(
  '/menu',
  asyncHandler(async (req, res) => {
    const categories = await db.all(
      'SELECT * FROM categories WHERE restaurant_id = ? ORDER BY display_order, id',
      [req.restaurantId]
    );
    const items = await db.all(
      `SELECT mi.* FROM menu_items mi
         JOIN categories c ON c.id = mi.category_id
        WHERE c.restaurant_id = ?
        ORDER BY mi.display_order, mi.id`,
      [req.restaurantId]
    );

    res.json(
      categories.map((category) => ({
        ...mapCategory(category),
        items: items.filter((item) => item.category_id === category.id).map(mapItem),
      }))
    );
  })
);

router.post(
  '/menu-items',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const category = await ownedCategory(toId(body.categoryId, 'الفئة'), req.restaurantId);
    const name = toText(body.name, { field: 'اسم الطبق', required: true, max: 255 });
    const description = toText(body.description, { field: 'الوصف', max: 2000 });
    const price = toPrice(body.price);
    const available = toBool(body.available, true) ? 1 : 0;

    let order = toOrder(body.displayOrder, null);
    if (order === null) {
      const last = await db.get(
        'SELECT MAX(display_order) AS max_order FROM menu_items WHERE category_id = ?',
        [category.id]
      );
      order = Number(last && last.max_order ? last.max_order : 0) + 1;
    }

    const result = await db.run(
      `INSERT INTO menu_items (category_id, name, description, price, image_url, available, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [category.id, name, description, price, toPublicUrl(req.file && req.file.filename), available, order]
    );

    const created = await db.get('SELECT * FROM menu_items WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, item: mapItem(created) });
  })
);

router.put(
  '/menu-items/:itemId',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const item = await ownedItem(toId(req.params.itemId), req.restaurantId);
    const body = req.body || {};

    const categoryId =
      body.categoryId === undefined || body.categoryId === ''
        ? item.category_id
        : toId(body.categoryId, 'الفئة');
    if (categoryId !== item.category_id) {
      await ownedCategory(categoryId, req.restaurantId);
    }

    const name = toText(body.name === undefined ? item.name : body.name, {
      field: 'اسم الطبق',
      required: true,
      max: 255,
    });
    const description = toText(
      body.description === undefined ? item.description : body.description,
      { field: 'الوصف', max: 2000 }
    );
    const price = toPrice(body.price === undefined ? item.price : body.price);
    const available = toBool(
      body.available === undefined ? Boolean(Number(item.available)) : body.available,
      true
    );
    const displayOrder = toOrder(
      body.displayOrder === undefined ? item.display_order : body.displayOrder,
      Number(item.display_order || 0)
    );

    let imageUrl = item.image_url;
    if (req.file) {
      if (imageUrl) removeUploadedFile(imageUrl);
      imageUrl = toPublicUrl(req.file.filename);
    } else if (body.removeImage === 'true' || body.removeImage === true) {
      removeUploadedFile(imageUrl);
      imageUrl = null;
    }

    await db.run(
      `UPDATE menu_items
          SET category_id = ?, name = ?, description = ?, price = ?, image_url = ?, available = ?, display_order = ?
        WHERE id = ?`,
      [categoryId, name, description, price, imageUrl, available ? 1 : 0, displayOrder, item.id]
    );

    const updated = await db.get('SELECT * FROM menu_items WHERE id = ?', [item.id]);
    res.json({ success: true, item: mapItem(updated) });
  })
);

router.delete(
  '/menu-items/:itemId',
  asyncHandler(async (req, res) => {
    const item = await ownedItem(toId(req.params.itemId), req.restaurantId);
    await db.run('DELETE FROM menu_items WHERE id = ?', [item.id]);
    removeUploadedFile(item.image_url);
    res.json({ success: true });
  })
);

// =============== الطاولات و QR ===============

router.get(
  '/tables',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      'SELECT * FROM tables WHERE restaurant_id = ? ORDER BY table_number, id',
      [req.restaurantId]
    );
    const baseUrl = resolveBaseUrl(req);

    const tables = await Promise.all(
      rows.map(async (row) => {
        const url = buildTableLink(baseUrl, req.restaurantId, row.table_number);
        return { ...mapTable(row), url, qr: await toDataUrl(url) };
      })
    );

    res.json(tables);
  })
);

router.post(
  '/tables',
  asyncHandler(async (req, res) => {
    const tableNumber = toId((req.body || {}).tableNumber, 'رقم الطاولة');
    if (tableNumber > 9999) throw new HttpError(400, 'رقم الطاولة كبير جداً');

    const baseUrl = resolveBaseUrl(req);
    const url = buildTableLink(baseUrl, req.restaurantId, tableNumber);

    try {
      const result = await db.run(
        'INSERT INTO tables (restaurant_id, table_number, qr_code) VALUES (?, ?, ?)',
        [req.restaurantId, tableNumber, `/menu/${req.restaurantId}?table=${tableNumber}`]
      );
      const created = await db.get('SELECT * FROM tables WHERE id = ?', [result.insertId]);
      res.status(201).json({
        success: true,
        table: { ...mapTable(created), url, qr: await toDataUrl(url) },
      });
    } catch (error) {
      if (isDuplicateError(error)) {
        throw new HttpError(409, `الطاولة رقم ${tableNumber} مضافة مسبقاً`);
      }
      throw error;
    }
  })
);

router.delete(
  '/tables/:tableId',
  asyncHandler(async (req, res) => {
    const tableId = toId(req.params.tableId, 'معرّف الطاولة');
    const result = await db.run('DELETE FROM tables WHERE id = ? AND restaurant_id = ?', [
      tableId,
      req.restaurantId,
    ]);
    if (!result.affectedRows) throw new HttpError(404, 'الطاولة غير موجودة');
    res.json({ success: true });
  })
);

module.exports = router;
