#!/usr/bin/env node
'use strict';

/**
 * تهيئة قاعدة البيانات يدوياً:
 *   npm run init-db            -> إنشاء الجداول + بيانات العينة إن لم تكن موجودة
 *   npm run init-db -- --force -> حذف البيانات الحالية وإعادة الإنشاء من الصفر
 *
 * يعمل على MySQL (حسب .env) أو SQLite عند عدم توفره.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const ROOT = path.join(__dirname, '..');

async function dropMysqlDatabase() {
  const mysql = require('mysql2/promise');
  const database = (process.env.DB_NAME || 'sharq_taste').replace(/`/g, '');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    console.log(`[init-db] تم حذف قاعدة البيانات ${database}`);
  } finally {
    await connection.end();
  }
}

async function run() {
  const force = process.argv.includes('--force');

  if (force) {
    const client = (process.env.DB_CLIENT || 'auto').toLowerCase();
    const sqliteFile = path.resolve(ROOT, process.env.SQLITE_PATH || 'data/sharq_taste.db');

    if (client !== 'sqlite') {
      try {
        await dropMysqlDatabase();
      } catch (error) {
        console.warn(`[init-db] تعذّر حذف قاعدة MySQL: ${error.message}`);
      }
    }

    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${sqliteFile}${suffix}`;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[init-db] تم حذف الملف ${path.basename(file)}`);
      }
    }
  }

  await db.init();

  const stats = await db.get(
    'SELECT (SELECT COUNT(*) FROM restaurants) AS restaurants, ' +
      '(SELECT COUNT(*) FROM categories) AS categories, ' +
      '(SELECT COUNT(*) FROM menu_items) AS items, ' +
      '(SELECT COUNT(*) FROM tables) AS tables'
  );

  console.log('');
  console.log(`[init-db] ✅ قاعدة البيانات جاهزة (${db.info || db.client})`);
  console.log(
    `[init-db] المطاعم: ${stats.restaurants} | الفئات: ${stats.categories} | الأطباق: ${stats.items} | الطاولات: ${stats.tables}`
  );
  console.log(`[init-db] كلمة مرور لوحة التحكم: ${process.env.DEFAULT_ADMIN_PASSWORD || 'admin123'}`);
  console.log('');

  await db.close();
}

run().catch((error) => {
  console.error('[init-db] ❌ فشلت التهيئة:', error.message);
  process.exit(1);
});
