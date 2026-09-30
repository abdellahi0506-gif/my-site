'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, UPLOAD_DIR),
  filename: (req, file, callback) => {
    const extension = ALLOWED_TYPES[file.mimetype] || path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    callback(null, `${unique}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return callback(new Error('صيغة الصورة غير مدعومة (المسموح: JPG, PNG, WEBP, GIF, AVIF)'));
    }
    callback(null, true);
  },
});

/** يحذف صورة مرفوعة سابقاً من مجلد uploads */
function removeUploadedFile(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;
  if (!imageUrl.startsWith('/uploads/')) return;

  const filename = path.basename(imageUrl);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!filePath.startsWith(UPLOAD_DIR)) return;

  fs.promises.unlink(filePath).catch(() => {
    /* الملف غير موجود — لا مشكلة */
  });
}

/** يحوّل مسار الصورة المرفوع إلى رابط عام */
function toPublicUrl(filename) {
  return filename ? `/uploads/${filename}` : null;
}

module.exports = { upload, UPLOAD_DIR, removeUploadedFile, toPublicUrl };
