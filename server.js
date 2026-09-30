'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const { db } = require('./src/db');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');
const { HttpError } = require('./src/utils/http-error');
const { removeUploadedFile } = require('./src/middleware/upload');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// الملفات الثابتة: الواجهة + الصور المرفوعة
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: db.client || 'not-connected', time: new Date().toISOString() });
});

app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

// صفحة منيو الزائر: /menu/:restaurantId
app.get('/menu/:restaurantId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

// معالج الأخطاء الموحّد
app.use((error, req, res, next) => {
  // لا نترك صوراً معلّقة في مجلد الرفع عند فشل الطلب
  if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`);

  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'حجم الصورة أكبر من 5 ميجابايت' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'صيغة البيانات المُرسلة غير صحيحة' });
  }
  if (error.message && /صيغة الصورة/.test(error.message)) {
    return res.status(400).json({ error: error.message });
  }

  console.error('[server] خطأ غير متوقع:', error);
  res.status(500).json({ error: 'حدث خطأ في الخادم' });
});

async function start() {
  await db.init();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  🍽️  طعم الشرق — نظام المنيو الإلكتروني');
    console.log(`  ➜  الواجهة:        http://localhost:${PORT}/`);
    console.log(`  ➜  المنيو:         http://localhost:${PORT}/menu/1`);
    console.log(`  ➜  لوحة التحكم:    http://localhost:${PORT}/admin.html`);
    console.log(`  ➜  قاعدة البيانات: ${db.info || db.client}`);
    console.log('');
  });

  const shutdown = async () => {
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('[server] تعذّر تشغيل الخادم:', error.message);
    process.exit(1);
  });
}

module.exports = { app, start };
