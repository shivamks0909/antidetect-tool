const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://cypher1446_db_user:1DddU8Z92l7dxNbn@cluster0.kopsso3.mongodb.net/?appName=Cluster0';

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('opinion_insights');
  const adminId = '6a9dd967a5908a7d870d8ebf';
  const query = { $or: [{ owner_account_id: adminId }, { userId: adminId }] };
  const pms = await db.collection('profile_metas').find(query).toArray();
  console.log('Admin profile_metas count:', pms.length);
  pms.forEach(p => console.log('  pm:', p.id, p.name));
  const profs = await db.collection('profiles').find(query).toArray();
  console.log('Admin profiles count:', profs.length);
  profs.forEach(p => console.log('  prof:', p.id, p.name));
  
  const bunnyUser = await db.collection('users').findOne({ email: 'bunny@panelflow.com' });
  if (bunnyUser) {
    const bunnyId = bunnyUser._id.toString();
    console.log('\nBunny user id:', bunnyId, bunnyUser.email);
    const bunnyQuery = { $or: [{ owner_account_id: bunnyId }, { userId: bunnyId }] };
    const bunnyPms = await db.collection('profile_metas').find(bunnyQuery).toArray();
    console.log('Bunny profile_metas count:', bunnyPms.length);
    bunnyPms.forEach(p => console.log('  bunny pm:', p.id, p.name));
    const bunnyProfs = await db.collection('profiles').find(bunnyQuery).toArray();
    console.log('Bunny profiles count:', bunnyProfs.length);
    bunnyProfs.forEach(p => console.log('  bunny prof:', p.id, p.name));
  }
  
  await client.close();
}
run().catch(console.error);
