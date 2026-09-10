import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "opinion_insights";

if (!uri) {
  throw new Error("MONGODB_URI missing in server environment!");
}

let client = global._mongoClient || null;
let db = global._mongoDb || null;
let clientPromise = global._mongoClientPromise || null;

export async function connectDB() {
  if (db) return db;

  if (!clientPromise) {
    client = new MongoClient(uri, {
      tls: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    global._mongoClient = client;

    clientPromise = client.connect().then(async (c) => {
      db = c.db(dbName);
      global._mongoDb = db;
      console.log(`[MongoDB] Connected successfully to database: ${dbName}`);
      try {
        await runMigrations(db);
      } catch (migErr) {
        console.warn("[MongoDB Migration Warning]", migErr.message);
      }
      return db;
    }).catch((err) => {
      clientPromise = null;
      global._mongoClientPromise = null;
      throw err;
    });

    global._mongoClientPromise = clientPromise;
  }

  return clientPromise;
}

export async function runMigrations(database) {
  const db = database || getDB();
  console.log("[MongoDB] Running database migrations & ownership verification...");

  // 1. Ensure indexes for owner-scoped queries
  await Promise.allSettled([
    db.collection("profiles").createIndex({ owner_account_id: 1, id: 1 }, { background: true }),
    db.collection("profile_metas").createIndex({ owner_account_id: 1, id: 1 }, { background: true }),
    db.collection("profile_metas").createIndex({ userId: 1, id: 1 }, { background: true }),
    db.collection("proxies").createIndex({ owner_account_id: 1, id: 1 }, { background: true }),
    db.collection("user_proxies").createIndex({ owner_account_id: 1, id: 1 }, { background: true }),
    db.collection("user_proxies").createIndex({ userId: 1, id: 1 }, { background: true }),
    db.collection("fingerprints").createIndex({ owner_account_id: 1, id: 1 }, { background: true }),
    db.collection("bookmarks").createIndex({ owner_account_id: 1, id: 1 }, { background: true }),
    db.collection("folders").createIndex({ owner_account_id: 1 }, { background: true }),
    db.collection("tags").createIndex({ owner_account_id: 1 }, { background: true }),
    db.collection("extension_sets").createIndex({ owner_account_id: 1, id: 1 }, { background: true }),
    db.collection("audit_logs").createIndex({ actorId: 1, timestamp: -1 }, { background: true }),
    db.collection("active_sessions").createIndex({ tokenHash: 1 }, { background: true }),
    db.collection("active_sessions").createIndex({ userId: 1 }, { background: true }),
  ]);

  // 2. Migrate legacy profiles in profile_metas & profiles
  const profileCols = ["profile_metas", "profiles"];
  for (const colName of profileCols) {
    const cursor = db.collection(colName).find();
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;

      const ownerId = doc.owner_account_id || doc.userId;
      if (ownerId && typeof ownerId === "string" && ownerId.trim().length > 0) {
        if (!doc.owner_account_id || doc.owner_account_id !== ownerId) {
          await db.collection(colName).updateOne(
            { _id: doc._id },
            { $set: { owner_account_id: ownerId, userId: ownerId, updatedAt: new Date().toISOString() } }
          );
        }
      } else {
        // Quarantine ambiguous record without owner
        console.warn(`[Migration] Quarantining unowned profile ${doc._id} (id: ${doc.id}) from ${colName}`);
        await db.collection("quarantined_records").insertOne({
          originalCollection: colName,
          originalDoc: doc,
          quarantinedAt: new Date().toISOString(),
          reason: "Missing owner_account_id / userId in legacy data",
        });
        await db.collection(colName).deleteOne({ _id: doc._id });
      }
    }
  }

  // 3. Migrate legacy proxies
  const proxyCols = ["user_proxies", "proxies"];
  for (const colName of proxyCols) {
    const cursor = db.collection(colName).find();
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;

      const ownerId = doc.owner_account_id || doc.userId;
      if (ownerId && typeof ownerId === "string" && ownerId.trim().length > 0) {
        if (!doc.owner_account_id || doc.owner_account_id !== ownerId) {
          await db.collection(colName).updateOne(
            { _id: doc._id },
            { $set: { owner_account_id: ownerId, userId: ownerId, updatedAt: new Date().toISOString() } }
          );
        }
      } else {
        console.warn(`[Migration] Quarantining unowned proxy ${doc._id} (id: ${doc.id}) from ${colName}`);
        await db.collection("quarantined_records").insertOne({
          originalCollection: colName,
          originalDoc: doc,
          quarantinedAt: new Date().toISOString(),
          reason: "Missing owner_account_id / userId in legacy proxy",
        });
        await db.collection(colName).deleteOne({ _id: doc._id });
      }
    }
  }

  console.log("[MongoDB] Migration completed successfully.");
}

export function isDBConnected() {
  return Boolean(db);
}

export function getDB() {
  if (!db) {
    throw new Error("Database not initialized! Call connectDB first.");
  }
  return db;
}

export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    clientPromise = null;
    global._mongoClient = null;
    global._mongoDb = null;
    global._mongoClientPromise = null;
    console.log("[MongoDB] Connection closed.");
  }
}


