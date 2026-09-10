import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "opinion_insights";

async function main() {
  console.log("Connecting to MongoDB Atlas...");
  const client = new MongoClient(uri);
  await client.connect();
  console.log("Connected successfully!");

  const db = client.db(dbName);
  const collections = await db.listCollections().toArray();
  console.log("\n=== MongoDB Collections ===");
  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`- ${col.name}: ${count} document(s)`);
  }

  console.log("\n=== Users Sample ===");
  const users = await db.collection("users").find({}).limit(5).toArray();
  for (const u of users) {
    console.log(`- ID: ${u._id}, Email: ${u.email}, Role: ${u.role}, Active: ${u.isActive}, Created: ${u.createdAt}`);
  }

  console.log("\n=== Profiles Sample ===");
  const profiles = await db.collection("profile_metas").find({}).limit(3).toArray();
  for (const p of profiles) {
    console.log(`- ID: ${p.id || p._id}, UserId: ${p.userId}, Name: ${p.name || p.profile_name}`);
  }

  console.log("\n=== Proxies Sample ===");
  const proxies = await db.collection("proxy_configs").find({}).limit(3).toArray();
  for (const px of proxies) {
    console.log(`- ID: ${px.id || px._id}, UserId: ${px.userId}, Host: ${px.host}, Scheme: ${px.scheme}`);
  }

  await client.close();
}

main().catch(err => {
  console.error("MongoDB verification failed:", err);
  process.exit(1);
});
