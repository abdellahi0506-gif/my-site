'use strict';

const express = require('express');
const { db } = require('../db');
const { asyncHandler, HttpError } = require('../utils/http-error');
const { optionalAuth } = require('../middleware/auth');
const { mapRestaurant, mapCategory, mapItem } = require('../utils/mappers');
const { toBool } = require('../utils/validate');
const { buildTableLink, toDataUrl, toPngBuffer } = require('../utils/qr');
const { resolveBaseUrl } = require('../utils/base-url');

const router = express.Router();

/**
 * GET /api/menu/:restaurantId
 * منيو الزائر — لا يحتاج تسجيل دخول.
 * ?preview=1 مع توكن صاحب المطعم يعرض الفئات/الأطباق المخفية بلون مميّز.
 */
router.get(
  '/menu/:restaurantId',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
      throw new HttpError(404, 'المطعم غير موجود');
    }

    const restaurant = await db.get('SELECT * FROM restaurants WHERE id = ?', [restaurantId]);
    if (!restaurant) throw new HttpError(404, 'المطعم غير موجود');

    const preview = req.restaurantId === restaurantId && toBool(req.query.preview, false);

    const categories = await db.all(
      `SELECT * FROM categories
        WHERE restaurant_id = ?${preview ? '' : ' AND is_visible = 1'}
        ORDER BY display_order, id`,
      [restaurantId]
    );

    const items = await db.all(
      `SELECT mi.* FROM menu_items mi
        JOIN categories c ON c.id = mi.category_id
        WHERE c.restaurant_id = ?${preview ? '' : ' AND mi.available = 1'}
        ORDER BY mi.display_order, mi.id`,
      [restaurantId]
    );

    const grouped = categories.map((category) => ({
      ...mapCategory(category),
      items: items.filter((item) => item.category_id === category.id).map(mapItem),
    }));

    const tableNumber = Number(req.query.table);
    const hasTable = Number.isInteger(tableNumber) && tableNumber > 0;

    res.json({
      restaurant: mapRestaurant(restaurant),
      table: hasTable ? { number: tableNumber } : null,
      preview,
      updated_at: new Date().toISOString(),
      categories: grouped,
    });
  })
);

/**
 * GET /api/menu/:restaurantId/qr?table=1
 * يولّد رمز QR لطاولة معيّنة.
 *   ?format=png -> ملف صورة جاهز للطباعة
 *   بدون format -> JSON { url, qr }
 */
router.get(
  '/menu/:restaurantId/qr',
  asyncHandler(async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
      throw new HttpError(404, 'المطعم غير موجود');
    }

    const restaurant = await db.get('SELECT id FROM restaurants WHERE id = ?', [restaurantId]);
    if (!restaurant) throw new HttpError(404, 'المطعم غير موجود');

    const tableNumber = Number(req.query.table);
    if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
      throw new HttpError(400, 'رقم الطاولة مطلوب');
    }

    const link = buildTableLink(resolveBaseUrl(req), restaurantId, tableNumber);
    if (String(req.query.format).toLowerCase() === 'png') {
      const png = await toPngBuffer(link);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="table-${tableNumber}.png"`);
      return res.send(png);
    }

    res.json({ url: link, qr: await toDataUrl(link) });
  })
);

module.exports = router;
