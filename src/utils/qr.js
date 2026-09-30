'use strict';

const QRCode = require('qrcode');

const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 512,
  color: { dark: '#0f172a', light: '#ffffff' },
};

/** يبني رابط منيو الطاولة: https://example.com/menu/1?table=3 */
function buildTableLink(baseUrl, restaurantId, tableNumber) {
  const base = String(baseUrl).replace(/\/+$/, '');
  return `${base}/menu/${restaurantId}?table=${tableNumber}`;
}

/** رمز QR كصورة Data URL لعرضه في لوحة التحكم */
function toDataUrl(link) {
  return QRCode.toDataURL(link, QR_OPTIONS);
}

/** رمز QR كملف PNG للطباعة والتحميل */
function toPngBuffer(link) {
  return QRCode.toBuffer(link, { ...QR_OPTIONS, type: 'png' });
}

module.exports = { buildTableLink, toDataUrl, toPngBuffer };
