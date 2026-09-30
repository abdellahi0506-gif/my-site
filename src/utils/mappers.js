'use strict';

/** يحوّل صفّ المطعم إلى شكل آمن للإرسال (بدون بصمة كلمة المرور) */
function mapRestaurant(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    logo_url: row.logo_url,
    currency: row.currency || 'SAR',
    phone: row.phone,
    email: row.email,
    address: row.address,
    created_at: row.created_at,
  };
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    description: row.description,
    display_order: Number(row.display_order || 0),
    is_visible: row.is_visible === undefined ? true : Boolean(Number(row.is_visible)),
  };
}

function mapItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    image_url: row.image_url,
    available: row.available === undefined ? true : Boolean(Number(row.available)),
    display_order: Number(row.display_order || 0),
  };
}

function mapTable(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    table_number: Number(row.table_number),
    qr_code: row.qr_code,
    created_at: row.created_at,
  };
}

/** يميّز أخطاء القيود الفريدة (تكرار) في MySQL و SQLite */
function isDuplicateError(error) {
  if (!error) return false;
  if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) return true;
  return typeof error.message === 'string' && /unique constraint failed/i.test(error.message);
}

module.exports = { mapRestaurant, mapCategory, mapItem, mapTable, isDuplicateError };
