'use strict';

const { HttpError } = require('./http-error');

function toText(value, { field, required = false, max = 2000, min = 0 } = {}) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) {
    if (required) throw new HttpError(400, `${field} مطلوب`);
    return null;
  }
  if (text.length < min) throw new HttpError(400, `${field} قصير جداً`);
  if (text.length > max) throw new HttpError(400, `${field} أطول من الحد المسموح (${max} حرف)`);
  return text;
}

function toId(value, field = 'المعرّف') {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new HttpError(400, `${field} غير صالح`);
  }
  return number;
}

function toPrice(value, field = 'السعر') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new HttpError(400, `${field} يجب أن يكون رقماً موجباً`);
  }
  if (number > 99999999.99) throw new HttpError(400, `${field} أكبر من الحد المسموح`);
  return Math.round(number * 100) / 100;
}

function toOrder(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
}

function toBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function toCurrency(value) {
  const text = (value === undefined || value === null ? '' : String(value)).trim().toUpperCase();
  if (!text) return 'SAR';
  if (!/^[A-Z]{2,6}$/.test(text)) throw new HttpError(400, 'رمز العملة غير صالح');
  return text;
}

module.exports = { toText, toId, toPrice, toOrder, toBool, toCurrency };
