import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env files (Vercel uses root .env, local uses server/.env and server/.env.local)
if (process.env.VERCEL) {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
} else {
  dotenv.config();
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
  dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
}

// ─── MySQL Pool Config ───
const poolConfig = {
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || "3306"),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  connectTimeout: 15000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

let pool = null;

// ─── Schema: Auto-create tables ───
// Column names match MongoDB field names (camelCase) to minimize index.js changes.
// Data tables (profile_metas, user_proxies, fingerprints, bookmarks, extension_sets)
// use a JSON `document` column for schemaless data, with `id` as VARCHAR PK.
const SCHEMA_SQL = `
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

-- Fix tables that may have been created with wrong column names
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS email_verifications;
`;

// ─── Connection Pool ───
async function connectDB() {
  if (pool) {
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (e) {
      console.warn("[MySQL] Pool stale, recreating...");
      pool = null;
    }
  }

  pool = mysql.createPool(poolConfig);

  try {
    await pool.query("SELECT 1 AS ok");
    console.log("[MySQL] Connected successfully to", process.env.MYSQL_HOST);

    // Auto-create schema
    const statements = SCHEMA_SQL.split(";").filter(s => s.trim().length > 0);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
    console.log("[MySQL] Schema ensured.");

    return pool;
  } catch (err) {
    console.error("[MySQL] Connection failed:", err.message);
    pool = null;
    throw err;
  }
}

function getDB() {
  if (!pool) throw new Error("MySQL pool not initialized! Call connectDB first.");
  return pool;
}

function isDBConnected() {
  return Boolean(pool);
}

async function ensureDB() {
  if (pool) {
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (e) {
      pool = null;
    }
  }
  return await connectDB();
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("[MySQL] Connection pool closed.");
  }
}

export { connectDB, getDB, isDBConnected, ensureDB, closeDb };
