/* ==========================================================
   أدوات مشتركة للواجهة (تنبيهات، طلبات API، تنسيق الأسعار)
   ========================================================== */
(function () {
  'use strict';

  const TOKEN_KEY = 'sharq_admin_token';

  const CURRENCY_SYMBOLS = {
    SAR: 'ر.س',
    AED: 'د.إ',
    KWD: 'د.ك',
    QAR: 'ر.ق',
    BHD: 'د.ب',
    OMR: 'ر.ع',
    EGP: 'ج.م',
    JOD: 'د.أ',
    USD: '$',
    EUR: '€',
    TRY: '₺',
  };

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (_) {
      return null;
    }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) {
      /* التخزين غير متاح */
    }
  }

  /** طلب API موحّد مع رسائل خطأ عربية */
  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const token = getToken();
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const response = await fetch(path, { ...options, headers, body });

    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await response.json().catch(() => null);
    }

    if (!response.ok) {
      const error = new Error((payload && payload.error) || `خطأ في الطلب (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /** عرض رسالة سريعة */
  function toast(message, type = 'info', timeout = 3200) {
    const container = document.getElementById('toasts');
    if (!container) return;
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.textContent = message;
    container.appendChild(element);
    setTimeout(() => element.remove(), timeout);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // أرقام لاتينية (15) لأنها الأنسب لقوائم الأسعار في المنطقة
  let priceFormatter = null;
  try {
    priceFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch (_) {
    priceFormatter = null;
  }

  function formatPrice(value, currency) {
    const number = Number(value);
    const formatted = Number.isFinite(number)
      ? priceFormatter
        ? priceFormatter.format(number)
        : String(number)
      : '-';
    return { amount: formatted, symbol: CURRENCY_SYMBOLS[currency] || currency || '' };
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  window.Sharq = { api, toast, escapeHtml, formatPrice, copyToClipboard, getToken, setToken, TOKEN_KEY };
})();
