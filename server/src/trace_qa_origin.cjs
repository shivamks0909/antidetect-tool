const { MongoClient, ObjectId } = require('mongodb');
const uri = 'mongodb+srv://cypher1446_db_user:1DddU8Z92l7dxNbn@cluster0.kopsso3.mongodb.net/?appName=Cluster0';

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('opinion_insights');
  
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    const c = db.collection(col.name);
    const byName = await c.find({ name: /QA Automation Alpha/i }).toArray();
    if (byName.length > 0) {
      console.log(`Collection ${col.name} has ${byName.length} matches for name QA Automation Alpha:`);
      byName.forEach(x => console.log('  ->', x._id, x.id, x.name, x.userId, x.owner_account_id));
    }
    const byId = await c.find({ _id: new ObjectId('6a9e17fbd03c7b434b8b1fcc') }).toArray();
    if (byId.length > 0) {
      console.log(`Collection ${col.name} has match for _id 6a9e17fbd03c7b434b8b1fcc:`, byId);
    }
  }
  
  await client.close();
}
run().catch(console.error);
