'use strict';

/**
 * مساعد لبناء العناوين المطلقة (روابط QR) دون الحاجة لضبط BASE_URL:
 * يستخدم BASE_URL إن وُجد، وإلا يستنتج العنوان من الطلب نفسه
 * (مع دعم X-Forwarded-* عند التشغيل خلف بروكسي).
 */
function resolveBaseUrl(req) {
  const configured = (process.env.BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || `localhost:${process.env.PORT || 3000}`;

  return `${protocol}://${host}`;
}

module.exports = { resolveBaseUrl };
