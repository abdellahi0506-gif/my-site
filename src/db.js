'use strict';

/**
 * طبقة الوصول لقاعدة البيانات
 * ------------------------------------------------------------------
 * الافتراضي (DB_CLIENT=auto): يحاول الاتصال بـ MySQL، وإذا لم يتوفر
 * الخادم ينتقل تلقائياً إلى قاعدة SQLite مدمجة حتى يعمل المشروع مباشرة.
 *
 * DB_CLIENT=mysql  : MySQL فقط (يفشل بخطأ واضح إن لم يتوفر).
 * DB_CLIENT=sqlite : SQLite فقط.
 *
 * الواجهة الموحّدة (نفس الشكل للمحرّكين):
 *   await db.init()                          // اتصال + تهيئة أولية
 *   await db.run(sql, params)                // تنفيذ كتابة -> { insertId, affectedRows }
 *   await db.all(sql, params)                // كل النتائج -> []
 *   await db.get(sql, params)                // أول نتيجة أو null
 *   await db.withTransaction(async (tx) => ...)
 *   db.client                                // 'mysql' | 'sqlite'
 */

// إخفاء تحذير "experimental" الخاص بـ node:sqlite حتى تبقى مخرجات السجل نظيفة
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const type = typeof args[0] === 'string' ? args[0] : args[0] && args[0].type;
  if (type === 'ExperimentalWarning' && /sqlite/i.test(String(warning))) return;
  return originalEmitWarning.call(process, warning, ...args);
};

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const FILES = {
  mysql: {
    schema: path.join(ROOT, 'database', 'mysql', 'schema.sql'),
    seed: path.join(ROOT, 'database', 'mysql', 'seed.sql'),
  },
  sqlite: {
    schema: path.join(ROOT, 'database', 'sqlite', 'schema.sql'),
    seed: path.join(ROOT, 'database', 'sqlite', 'seed.sql'),
  },
};

const DB_CLIENT = (process.env.DB_CLIENT || 'auto').toLowerCase();
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

/** يحوّل قيم JS إلى قيم يقبلها محرّك SQLite */
function toSqliteValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** يحوّل BigInt إلى Number حتى يمكن إرسال النتائج كـ JSON */
function normalizeValue(value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  return value;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) out[key] = normalizeValue(value);
  return out;
}

/** يستبدل :TOKEN داخل ملف SQL بقيمة نصية مع تهريب علامات الاقتباس */
function substituteTokens(sql, tokens) {
  return Object.entries(tokens).reduce(
    (acc, [key, value]) => acc.replaceAll(`:${key}`, String(value).replace(/'/g, "''")),
    sql
  );
}

/**
 * تقسيم ملف SQL إلى عبارات منفصلة (نحتاجه لـ MySQL لأن تنفيذ
 * عدة عبارات في استعلام واحد غير مسموح افتراضياً).
 */
function splitStatements(sql) {
  const statements = [];
  let buffer = [];
  let inBlockComment = false;

  for (const rawLine of sql.split(/\r?\n/)) {
    let line = rawLine;

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }

    if (line.includes('/*')) {
      const start = line.indexOf('/*');
      const end = line.indexOf('*/', start);
      if (end === -1) {
        inBlockComment = true;
        line = line.slice(0, start);
      } else {
        line = line.slice(0, start) + line.slice(end + 2);
      }
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;

    buffer.push(line);
    if (trimmed.endsWith(';')) {
      statements.push(buffer.join('\n').trim().replace(/;$/, '').trim());
      buffer = [];
    }
  }

  const rest = buffer.join('\n').trim();
  if (rest) statements.push(rest);

  return statements.filter((statement) => statement.length > 0);
}

function isBootstrapStatement(statement) {
  return /^create\s+database/i.test(statement) || /^use\s+/i.test(statement);
}

function readSql(file) {
  return fs.readFileSync(file, 'utf8');
}

// ------------------------------------------------------------------
// تنفيذ MySQL
// ------------------------------------------------------------------
async function createMysqlClient() {
  const mysql = require('mysql2/promise');
  const database = process.env.DB_NAME || 'sharq_taste';
  const baseOptions = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 8000,
  };

  // 1) التأكد من وجود قاعدة البيانات نفسها
  const bootstrap = await mysql.createConnection(baseOptions);
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\`
       DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }

  // 2) مجمّع الاتصالات الأساسي
  const pool = mysql.createPool({ ...baseOptions, database });

  const makeExecutor = (runner) => ({
    async run(sql, params = []) {
      const [result] = await runner.query(sql, params);
      return {
        insertId: result && result.insertId !== undefined ? result.insertId : null,
        affectedRows: result && result.affectedRows !== undefined ? result.affectedRows : 0,
      };
    },
    async all(sql, params = []) {
      const [rows] = await runner.query(sql, params);
      return Array.isArray(rows) ? rows.map(normalizeRow) : [];
    },
    async get(sql, params = []) {
      const rows = await this.all(sql, params);
      return rows[0] || null;
    },
  });

  const executor = makeExecutor(pool);

  return {
    client: 'mysql',
    executor,
    pool,
    async withTransaction(callback) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await callback(makeExecutor(connection));
        await connection.commit();
        return result;
      } catch (error) {
        try {
          await connection.rollback();
        } catch (_) {
          /* تجاهل أخطاء التراجع */
        }
        throw error;
      } finally {
        connection.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

// ------------------------------------------------------------------
// تنفيذ SQLite (يعتمد على وحدة node:sqlite المدمجة في Node 22+)
// ------------------------------------------------------------------
async function createSqliteClient() {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (_) {
    throw new Error(
      'محرّك SQLite المدمج غير متاح في هذه النسخة من Node.js. ' +
        'استخدم Node 22 أو أحدث، أو شغّل MySQL واضبط DB_CLIENT=mysql في ملف .env'
    );
  }

  const file = path.resolve(ROOT, process.env.SQLITE_PATH || 'data/sharq_taste.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const database = new DatabaseSync(file);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');

  const executor = {
    async run(sql, params = []) {
      const info = database.prepare(sql).run(...params.map(toSqliteValue));
      return {
        insertId: info.lastInsertRowid === undefined ? null : Number(info.lastInsertRowid),
        affectedRows: Number(info.changes || 0),
      };
    },
    async all(sql, params = []) {
      return database.prepare(sql).all(...params.map(toSqliteValue)).map(normalizeRow);
    },
    async get(sql, params = []) {
      const rows = await this.all(sql, params);
      return rows[0] || null;
    },
  };

  return {
    client: 'sqlite',
    executor,
    file,
    async withTransaction(callback) {
      database.exec('BEGIN');
      try {
        const result = await callback(executor);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch (_) {
          /* تجاهل أخطاء التراجع */
        }
        throw error;
      }
    },
    async close() {
      database.close();
    },
  };
}

// ------------------------------------------------------------------
// التهيئة الأولية: إنشاء الجداول وإدراج بيانات العينة عند الحاجة
// ------------------------------------------------------------------
async function countTables(client) {
  const sql =
    client.client === 'mysql'
      ? `SELECT COUNT(*) AS total FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
      : `SELECT COUNT(*) AS total FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;
  const row = await client.executor.get(sql);
  return Number(row ? row.total : 0);
}

async function setupMysqlSchema(client) {
  const statements = splitStatements(readSql(FILES.mysql.schema)).filter(
    (statement) => !isBootstrapStatement(statement)
  );
  for (const statement of statements) {
    await client.executor.run(statement);
  }
}

async function setupSqliteSchema(client) {
  const statements = splitStatements(readSql(FILES.sqlite.schema));
  for (const statement of statements) {
    await client.executor.run(statement);
  }
}

async function seed(client) {
  const adminHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10);
  const seedSql = substituteTokens(readSql(FILES[client.client].seed), {
    ADMIN_HASH: adminHash,
  });

  for (const statement of splitStatements(seedSql)) {
    await client.executor.run(statement);
  }
}

let state = { ready: false, client: null, executor: null, info: null };

async function connect() {
  const errors = [];

  const tryMysql = DB_CLIENT === 'auto' || DB_CLIENT === 'mysql';
  const trySqlite = DB_CLIENT === 'auto' || DB_CLIENT === 'sqlite';

  if (tryMysql) {
    try {
      const client = await createMysqlClient();
      return { client, info: `MySQL (${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'sharq_taste'})` };
    } catch (error) {
      errors.push(`MySQL: ${error.code ? error.code + ' — ' : ''}${error.message || 'تعذّر الاتصال بالخادم'}`);
      if (DB_CLIENT === 'mysql') {
        throw new Error(
          `تعذّر الاتصال بـ MySQL: ${error.message}\n` +
            'تأكد من تشغيل الخادم وصحة بيانات .env، أو استخدم DB_CLIENT=sqlite للتطوير.'
        );
      }
    }
  }

  if (trySqlite) {
    try {
      const client = await createSqliteClient();
      return { client, info: `SQLite (${client.file})`, warning: errors[0] };
    } catch (error) {
      errors.push(`SQLite: ${error.message}`);
    }
  }

  throw new Error(`تعذّر تهيئة قاعدة البيانات:\n- ${errors.join('\n- ')}`);
}

async function init() {
  if (state.ready) return state;

  const { client, info, warning } = await connect();

  if (warning) {
    console.warn(`[db] تعذّر الاتصال بـ ${warning}`);
    console.warn('[db] تم التحويل تلقائياً إلى قاعدة SQLite المحلية.');
  }

  const existing = await countTables(client);
  if (existing === 0) {
    if (client.client === 'mysql') {
      await setupMysqlSchema(client);
    } else {
      await setupSqliteSchema(client);
    }
    await seed(client);
    console.log(`[db] تم إنشاء الجداول وإدراج بيانات العينة في ${info}`);
    console.log(`[db] كلمة مرور لوحة التحكم الافتراضية: ${DEFAULT_ADMIN_PASSWORD}`);
  } else {
    console.log(`[db] متصل بـ ${info}`);
  }

  state = {
    ready: true,
    client: client.client,
    executor: client.executor,
    withTransaction: client.withTransaction,
    close: client.close,
    connection: client,
    info,
  };
  return state;
}

async function withReady(fn) {
  const current = await init();
  return fn(current);
}

const db = {
  init,
  get client() {
    return state.client;
  },
  get info() {
    return state.info;
  },
  get isSqlite() {
    return state.client === 'sqlite';
  },
  run(sql, params) {
    return withReady((current) => current.executor.run(sql, params));
  },
  all(sql, params) {
    return withReady((current) => current.executor.all(sql, params));
  },
  async get(sql, params) {
    const rows = await withReady((current) => current.executor.all(sql, params));
    return rows[0] || null;
  },
  withTransaction(callback) {
    return withReady((current) => current.withTransaction(callback));
  },
  async close() {
    if (state.connection) {
      await state.connection.close();
      state = { ready: false, client: null, executor: null, info: null };
    }
  },
};

module.exports = { db, splitStatements, substituteTokens };
