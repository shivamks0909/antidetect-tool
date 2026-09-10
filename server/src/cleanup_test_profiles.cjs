const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://cypher1446_db_user:1DddU8Z92l7dxNbn@cluster0.kopsso3.mongodb.net/?appName=Cluster0';

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('opinion_insights');

  const adminId = '6a9dd967a5908a7d870d8ebf';
  console.log('Cleaning test/orphaned profiles from MongoDB for admin:', adminId);

  // Delete QA profiles from profile_metas and profiles
  const resMeta = await db.collection('profile_metas').deleteMany({
    $or: [
      { id: /qa_profile_alpha/i },
      { name: /QA Automation Alpha/i },
      { id: 'prof-1788800966130' }
    ]
  });
  console.log('Deleted from profile_metas:', resMeta.deletedCount);

  const resProf = await db.collection('profiles').deleteMany({
    $or: [
      { id: /qa_profile_alpha/i },
      { name: /QA Automation Alpha/i },
      { id: 'prof-1788800966130' }
    ]
  });
  console.log('Deleted from profiles:', resProf.deletedCount);

  // Check remaining for Admin
  const adminRemainingMeta = await db.collection('profile_metas').countDocuments({
    $or: [{ owner_account_id: adminId }, { userId: adminId }]
  });
  const adminRemainingProf = await db.collection('profiles').countDocuments({
    $or: [{ owner_account_id: adminId }, { userId: adminId }]
  });
  console.log(`Admin profiles remaining: metas=${adminRemainingMeta}, profiles=${adminRemainingProf}`);

  await client.close();
}

run().catch(console.error);
