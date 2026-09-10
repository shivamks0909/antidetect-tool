const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://cypher1446_db_user:1DddU8Z92l7dxNbn@cluster0.kopsso3.mongodb.net/?appName=Cluster0';

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('opinion_insights');
  
  const query = { id: { $regex: '5d8fbf27|d3e292b2|f68494be|39e5c038|3e1bacd6|de3ff05d' } };
  const p = await db.collection('profiles').find(query).toArray();
  console.log('Found in profiles:', p.length, p.map(x => ({ id: x.id, name: x.name, userId: x.userId, owner_account_id: x.owner_account_id })));
  
  const pm = await db.collection('profile_metas').find(query).toArray();
  console.log('Found in profile_metas:', pm.length, pm.map(x => ({ id: x.id, name: x.name, userId: x.userId })));
  
  const logs = await db.collection('audit_logs').find({ profile_id: { $regex: '5d8fbf27|d3e292b2|f68494be|39e5c038|3e1bacd6|de3ff05d' } }).toArray();
  console.log('Found in audit_logs:', logs.length);
  logs.forEach(l => console.log(l));
  
  await client.close();
}
run().catch(console.error);
