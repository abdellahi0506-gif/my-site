'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key-change-this';
const TOKEN_TTL = '24h';

if (SECRET_KEY === 'your-secret-key-change-this' || SECRET_KEY.length < 16) {
  console.warn(
    '[auth] تحذير: SECRET_KEY غير مضبوط أو قصير. اضبط قيمة قوية في ملف .env قبل النشر.'
  );
}

function signToken(restaurantId) {
  return jwt.sign({ restaurantId }, SECRET_KEY, { expiresIn: TOKEN_TTL });
}

/** يتأكد من وجود توكن صالح */
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

  jwt.verify(token, SECRET_KEY, (error, decoded) => {
    if (error) return res.status(403).json({ error: 'الجلسة منتهية، برجاء تسجيل الدخول مجدداً' });
    req.restaurantId = decoded.restaurantId;
    next();
  });
}

/** يقرأ التوكن إن وُجد دون إلزام المستخدم بتسجيل الدخول */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();

  jwt.verify(token, SECRET_KEY, (error, decoded) => {
    if (!error && decoded) req.restaurantId = decoded.restaurantId;
    next();
  });
}

module.exports = { SECRET_KEY, TOKEN_TTL, signToken, authenticateToken, optionalAuth };
