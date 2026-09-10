import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "opinion_insights");
  const logs = await db.collection("audit_logs").find({ action: "LOGIN_SUCCESS" }).sort({ timestamp: -1 }).limit(5).toArray();
  console.log("Recent LOGIN_SUCCESS logs:");
  for (const l of logs) {
    console.log(l.timestamp, "actorEmail:", l.actorEmail, "actorId:", l.actorId, "action:", l.action, "details:", l.details);
  }
  await client.close();
}

main().catch(console.error);
