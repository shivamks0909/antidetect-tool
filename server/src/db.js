import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env files
if (process.env.VERCEL) {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
} else {
  dotenv.config();
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
  dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
}

// ─── MySQL Pool Config ───
const poolConfig = {
  host: (process.env.MYSQL_HOST || "").trim(),
  port: parseInt((process.env.MYSQL_PORT || "3306").trim()),
  user: (process.env.MYSQL_USER || "").trim(),
  password: (process.env.MYSQL_PASSWORD || "").trim(),
  database: (process.env.MYSQL_DATABASE || "").trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  connectTimeout: 2500,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

let activeEngine = "none"; // 'mysql' | 'sqlite' | 'none'
let mysqlPool = null;
let sqliteDb = null;

// ─── MySQL Schema ───
const MYSQL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  passwordHash VARCHAR(255) NOT NULL,
  fullName VARCHAR(255) NOT NULL DEFAULT '',
  role ENUM('admin','vendor','user') NOT NULL DEFAULT 'user',
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  twoFactorEnabled BOOLEAN NOT NULL DEFAULT FALSE,
  twoFactorSecret VARCHAR(255) DEFAULT NULL,
  tempTwoFactorSecret VARCHAR(255) DEFAULT NULL,
  recoveryCodes JSON DEFAULT NULL,
  failedAttempts INT NOT NULL DEFAULT 0,
  lockoutUntil DATETIME DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS active_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  userEmail VARCHAR(255) DEFAULT '',
  tokenHash VARCHAR(255) NOT NULL,
  userAgent VARCHAR(500) DEFAULT '',
  ip VARCHAR(50) DEFAULT '',
  isRevoked BOOLEAN NOT NULL DEFAULT FALSE,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastActiveAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revokedAt DATETIME DEFAULT NULL,
  expiresAt DATETIME DEFAULT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tokenHash (tokenHash),
  INDEX idx_userId (userId)
);

CREATE TABLE IF NOT EXISTS profile_metas (
  id VARCHAR(255) PRIMARY KEY,
  owner_account_id VARCHAR(255) NOT NULL,
  userId VARCHAR(255) DEFAULT NULL,
  document JSON NOT NULL,
  INDEX idx_owner (owner_account_id),
  INDEX idx_user (userId)
);

CREATE TABLE IF NOT EXISTS profiles (
  id VARCHAR(255) PRIMARY KEY,
  owner_account_id VARCHAR(255) NOT NULL,
  userId VARCHAR(255) DEFAULT NULL,
  document JSON NOT NULL,
  INDEX idx_owner (owner_account_id),
  INDEX idx_user (userId)
);

CREATE TABLE IF NOT EXISTS user_proxies (
  id VARCHAR(255) PRIMARY KEY,
  owner_account_id VARCHAR(255) NOT NULL,
  userId VARCHAR(255) DEFAULT NULL,
  document JSON NOT NULL,
  INDEX idx_owner (owner_account_id),
  INDEX idx_user (userId)
);

CREATE TABLE IF NOT EXISTS proxies (
  id VARCHAR(255) PRIMARY KEY,
  owner_account_id VARCHAR(255) NOT NULL,
  userId VARCHAR(255) DEFAULT NULL,
  document JSON NOT NULL,
  INDEX idx_owner (owner_account_id),
  INDEX idx_user (userId)
);

CREATE TABLE IF NOT EXISTS fingerprints (
  id VARCHAR(255) PRIMARY KEY,
  owner_account_id VARCHAR(255) NOT NULL,
  userId VARCHAR(255) DEFAULT NULL,
  document JSON NOT NULL,
  INDEX idx_owner (owner_account_id),
  INDEX idx_user (userId)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id VARCHAR(255) PRIMARY KEY,
  owner_account_id VARCHAR(255) NOT NULL,
  userId VARCHAR(255) DEFAULT NULL,
  document JSON NOT NULL,
  INDEX idx_owner (owner_account_id),
  INDEX idx_user (userId)
);

CREATE TABLE IF NOT EXISTS extension_sets (
  id VARCHAR(255) PRIMARY KEY,
  owner_account_id VARCHAR(255) NOT NULL,
  userId VARCHAR(255) DEFAULT NULL,
  document JSON NOT NULL,
  INDEX idx_owner (owner_account_id),
  INDEX idx_user (userId)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actorId VARCHAR(255) NOT NULL,
  actorEmail VARCHAR(255) DEFAULT '',
  action VARCHAR(100) NOT NULL,
  targetId VARCHAR(255) DEFAULT NULL,
  details JSON DEFAULT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_actor (actorId),
  INDEX idx_timestamp (timestamp)
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  tokenHash VARCHAR(255) NOT NULL,
  isUsed BOOLEAN NOT NULL DEFAULT FALSE,
  usedAt DATETIME DEFAULT NULL,
  expiresAt DATETIME NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tokenHash (tokenHash),
  INDEX idx_userId (userId)
);

CREATE TABLE IF NOT EXISTS system_config (
  configKey VARCHAR(255) PRIMARY KEY,
  manifest JSON DEFAULT NULL,
  updatedAt DATETIME DEFAULT NULL,
  publishedBy VARCHAR(255) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(20) NOT NULL,
  expiresAt DATETIME NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quarantined_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  originalCollection VARCHAR(255) NOT NULL,
  originalDoc JSON NOT NULL,
  quarantinedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);
`;

// ─── SQLite Schema ───
const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  fullName TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  isActive INTEGER NOT NULL DEFAULT 1,
  twoFactorEnabled INTEGER NOT NULL DEFAULT 0,
  twoFactorSecret TEXT DEFAULT NULL,
  tempTwoFactorSecret TEXT DEFAULT NULL,
  recoveryCodes TEXT DEFAULT NULL,
  failedAttempts INTEGER NOT NULL DEFAULT 0,
  lockoutUntil TEXT DEFAULT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS active_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  userEmail TEXT DEFAULT '',
  tokenHash TEXT NOT NULL,
  userAgent TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  isRevoked INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastActiveAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revokedAt TEXT DEFAULT NULL,
  expiresAt TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS profile_metas (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  userId TEXT DEFAULT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  userId TEXT DEFAULT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_proxies (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  userId TEXT DEFAULT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  userId TEXT DEFAULT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fingerprints (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  userId TEXT DEFAULT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  userId TEXT DEFAULT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extension_sets (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  userId TEXT DEFAULT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actorId TEXT NOT NULL,
  actorEmail TEXT DEFAULT '',
  action TEXT NOT NULL,
  targetId TEXT DEFAULT NULL,
  details TEXT DEFAULT NULL,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  email TEXT NOT NULL,
  tokenHash TEXT NOT NULL,
  isUsed INTEGER NOT NULL DEFAULT 0,
  usedAt TEXT DEFAULT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_config (
  configKey TEXT PRIMARY KEY,
  manifest TEXT DEFAULT NULL,
  updatedAt TEXT DEFAULT NULL,
  publishedBy TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quarantined_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  originalCollection TEXT NOT NULL,
  originalDoc TEXT NOT NULL,
  quarantinedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);
`;

// ─── SQL Translator for SQLite Compatibility ───
function translateSqlForSqlite(sql) {
  let s = sql;
  // Translate JSON_UNQUOTE(JSON_EXTRACT(doc, '$.path')) -> json_extract(doc, '$.path')
  s = s.replace(/JSON_UNQUOTE\s*\(\s*JSON_EXTRACT\s*\(([^,]+),\s*([^)]+)\)\s*\)/gi, "json_extract($1, $2)");
  
  // Translate ON DUPLICATE KEY UPDATE
  if (/ON DUPLICATE KEY UPDATE/i.test(s)) {
    if (/system_config/i.test(s)) {
      s = s.replace(/ON DUPLICATE KEY UPDATE.*/i, "ON CONFLICT(configKey) DO UPDATE SET manifest = excluded.manifest, updatedAt = excluded.updatedAt, publishedBy = excluded.publishedBy");
    } else {
      s = s.replace(/ON DUPLICATE KEY UPDATE.*/i, "ON CONFLICT(id) DO UPDATE SET document = excluded.document, owner_account_id = excluded.owner_account_id, userId = excluded.userId");
    }
  }
  return s;
}

// ─── SQLite Engine Initialization ───
function initSqlite() {
  if (sqliteDb) return sqliteDb;

  const dataDir = process.env.VERCEL
    ? path.join(os.tmpdir(), "opinion_insights_data")
    : path.resolve(__dirname, "../data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbFilePath = path.join(dataDir, "opinion_insights.db");
  sqliteDb = new DatabaseSync(dbFilePath);

  // Ensure tables
  const statements = SQLITE_SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    sqliteDb.exec(stmt);
  }

  activeEngine = "sqlite";
  console.log(`[Database] Embedded SQLite engine active (${dbFilePath})`);

  // Auto-seed default admin and vendor if table is empty
  try {
    const userCount = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM users").all()[0]?.cnt || 0;
    if (userCount === 0) {
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync("Delle6400@", salt);
      const insert = sqliteDb.prepare(
        "INSERT INTO users (email, passwordHash, fullName, role, isActive, twoFactorEnabled, failedAttempts) VALUES (?, ?, ?, ?, 1, 0, 0)"
      );
      insert.run("admin@opinioninsights.in", passwordHash, "Admin", "admin");
      insert.run("admin@opinioninsights.com", passwordHash, "Admin", "admin");
      insert.run("vendor@opinioninsights.in", passwordHash, "Default Vendor", "vendor");
      console.log("[Database] Default users auto-seeded in SQLite.");
    }
  } catch (seedErr) {
    console.warn("[Database] SQLite initial seed check error:", seedErr.message);
  }

  return sqliteDb;
}

// ─── Unified Database Wrapper Interface ───
const dbWrapper = {
  getEngine: () => activeEngine,
  
  query: async (sql, params = []) => {
    if (activeEngine === "mysql" && mysqlPool) {
      try {
        return await mysqlPool.query(sql, params);
      } catch (err) {
        // If fatal connection error, failover to SQLite
        if (
          err.code === "PROTOCOL_CONNECTION_LOST" ||
          err.code === "ECONNRESET" ||
          err.code === "ENOTFOUND" ||
          err.code === "ETIMEDOUT"
        ) {
          console.warn(`[Database] MySQL query failed (${err.code}). Failing over to SQLite...`);
          initSqlite();
          // Fall through to SQLite execution
        } else {
          throw err;
        }
      }
    }

    // SQLite Execution
    if (!sqliteDb) {
      initSqlite();
    }

    const translatedSql = translateSqlForSqlite(sql);
    const trimmed = translatedSql.trim();
    const isSelect = /^SELECT/i.test(trimmed);

    try {
      const stmt = sqliteDb.prepare(translatedSql);
      if (isSelect) {
        const rawRows = stmt.all(...params);
        const rows = rawRows.map(r => Object.assign({}, r));
        return [rows, []];
      } else {
        const res = stmt.run(...params);
        return [{ insertId: Number(res.lastInsertRowid), affectedRows: res.changes }, []];
      }
    } catch (sqliteErr) {
      console.error("[Database] SQLite query error:", sqliteErr.message, "SQL:", translatedSql);
      throw sqliteErr;
    }
  },

  end: async () => {
    if (mysqlPool) {
      await mysqlPool.end();
      mysqlPool = null;
    }
    sqliteDb = null;
    activeEngine = "none";
  }
};

// ─── Connection Orchestrator ───
async function connectDB() {
  if (activeEngine === "mysql" && mysqlPool) {
    try {
      await mysqlPool.query("SELECT 1");
      return dbWrapper;
    } catch (e) {
      console.warn("[MySQL] Pool connection lost. Re-testing...");
      mysqlPool = null;
    }
  }

  // Try MySQL if host configured
  if (poolConfig.host && poolConfig.host !== "localhost" && poolConfig.host !== "127.0.0.1") {
    try {
      console.log(`[Database] Attempting connection to MySQL: ${poolConfig.host}:${poolConfig.port}...`);
      const tempPool = mysql.createPool(poolConfig);
      await tempPool.query("SELECT 1 AS ok");
      mysqlPool = tempPool;
      activeEngine = "mysql";
      console.log("[MySQL] Connected successfully to", poolConfig.host);

      // Auto-create MySQL schema
      const statements = MYSQL_SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await mysqlPool.query(stmt);
      }
      console.log("[MySQL] Schema verified.");
      return dbWrapper;
    } catch (err) {
      console.warn(`[Database] MySQL unavailable (${err.code || err.message}). Auto-switching to embedded SQLite.`);
      mysqlPool = null;
    }
  }

  // Fallback: Local Persistent SQLite
  initSqlite();
  return dbWrapper;
}

function getDB() {
  if (activeEngine === "none" || (!mysqlPool && !sqliteDb)) {
    // Auto-initialize SQLite on-demand
    initSqlite();
  }
  return dbWrapper;
}

function isDBConnected() {
  return activeEngine !== "none" && (Boolean(mysqlPool) || Boolean(sqliteDb));
}

async function ensureDB() {
  if (isDBConnected()) {
    return dbWrapper;
  }
  return await connectDB();
}

async function closeDb() {
  await dbWrapper.end();
}

// ─── Auto-Fixer Core: Guarantees Admin Login Permanently ───
async function autoFixDatabase() {
  const db = await ensureDB();
  const report = {
    engine: activeEngine,
    timestamp: new Date().toISOString(),
    actions: [],
    fixed: true,
  };

  try {
    // 1. Schema check & initialization
    if (activeEngine === "mysql") {
      const statements = MYSQL_SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await db.query(stmt);
      }
      report.actions.push("MySQL schema validated & ensured.");
    } else {
      const statements = SQLITE_SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        sqliteDb.exec(stmt);
      }
      report.actions.push("SQLite schema validated & ensured.");
    }

    // 2. Guarantee Admin Accounts Exist with Delle6400@
    const adminAccounts = [
      "admin@opinioninsights.in",
      "admin@opinioninsights.com"
    ];

    const passwordPlain = "Delle6400@";
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(passwordPlain, salt);

    for (const email of adminAccounts) {
      const [rows] = await db.query("SELECT id, failedAttempts, lockoutUntil FROM users WHERE email = ?", [email]);
      if (rows.length === 0) {
        await db.query(
          "INSERT INTO users (email, passwordHash, fullName, role, isActive, twoFactorEnabled, failedAttempts) VALUES (?, ?, ?, ?, 1, 0, 0)",
          [email, passwordHash, "Admin", "admin"]
        );
        report.actions.push(`Created admin account: ${email}`);
      } else {
        // Unlock and reset failed attempts, update passwordHash to valid hash
        await db.query(
          "UPDATE users SET passwordHash = ?, isActive = 1, failedAttempts = 0, lockoutUntil = NULL WHERE email = ?",
          [passwordHash, email]
        );
        report.actions.push(`Unlocked and synchronized credentials for admin: ${email}`);
      }
    }

    // 3. Guarantee Vendor account exists
    const vendorEmail = "vendor@opinioninsights.in";
    const [vendorRows] = await db.query("SELECT id FROM users WHERE email = ?", [vendorEmail]);
    if (vendorRows.length === 0) {
      await db.query(
        "INSERT INTO users (email, passwordHash, fullName, role, isActive, twoFactorEnabled, failedAttempts) VALUES (?, ?, ?, ?, 1, 0, 0)",
        [vendorEmail, passwordHash, "Default Vendor", "vendor"]
      );
      report.actions.push(`Created vendor account: ${vendorEmail}`);
    } else {
      await db.query(
        "UPDATE users SET passwordHash = ?, isActive = 1, failedAttempts = 0, lockoutUntil = NULL WHERE email = ?",
        [passwordHash, vendorEmail]
      );
      report.actions.push(`Synchronized vendor account: ${vendorEmail}`);
    }

    // 4. Verify password hashing works
    const [verifyRows] = await db.query("SELECT passwordHash FROM users WHERE email = ?", ["admin@opinioninsights.in"]);
    const isPwValid = await bcrypt.compare(passwordPlain, verifyRows[0].passwordHash);
    report.verified = isPwValid;
    report.actions.push(`Admin credential authentication verified: ${isPwValid ? "OK" : "FAILED"}`);

    console.log("[AutoFix] Database and auth repair completed successfully:", report);
    return report;
  } catch (err) {
    console.error("[AutoFix] Error during auto-fix:", err);
    report.fixed = false;
    report.error = err.message;
    return report;
  }
}

export {
  connectDB,
  getDB,
  isDBConnected,
  ensureDB,
  closeDb,
  autoFixDatabase,
  activeEngine
};
