/**
 * Debug script to check file entries in MongoDB
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { MongoClient } from 'mongodb';

const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DATABASE || 'quilltap';

async function main() {
  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI');
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(mongoDb);

    // Check files
    console.log('\n=== Files in MongoDB ===');
    const files = await db.collection('files').find({}).toArray();
    console.log(`Total files: ${files.length}`);

    for (const file of files) {
      console.log(`\n  ID: ${file.id}`);
      console.log(`  UserID: ${file.userId}`);
      console.log(`  Filename: ${file.originalFilename}`);
      console.log(`  Category: ${file.category}`);
      console.log(`  S3Key: ${file.s3Key}`);
      console.log(`  Tags: ${JSON.stringify(file.tags)}`);
    }

    // Check users
    console.log('\n=== Users in MongoDB ===');
    const users = await db.collection('users').find({}).toArray();
    console.log(`Total users: ${users.length}`);

    for (const user of users) {
      console.log(`\n  ID: ${user.id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Name: ${user.name}`);
    }

    // Check sessions
    console.log('\n=== Active Sessions ===');
    const sessions = await db.collection('sessions').find({}).toArray();
    console.log(`Total sessions: ${sessions.length}`);

    for (const session of sessions) {
      console.log(`\n  Token: ${session.sessionToken}`);
      console.log(`  UserID: ${session.userId}`);
      console.log(`  Expires: ${session.expires}`);
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
