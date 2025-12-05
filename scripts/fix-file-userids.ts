/**
 * Fix File UserIDs Script
 *
 * The files were created with the wrong userId from S3 path parsing.
 * This script updates all files to use the correct user ID.
 *
 * Usage: npx tsx scripts/fix-file-userids.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { MongoClient } from 'mongodb';

const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DATABASE || 'quilltap';

async function main() {
  console.log('=== Fix File UserIDs ===\n');

  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI');
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(mongoDb);

    // Get the actual user ID from the users collection
    const users = await db.collection('users').find({}).toArray();
    if (users.length === 0) {
      throw new Error('No users found in database');
    }

    // For now, assume single user - in a multi-user setup this would need more logic
    const correctUserId = users[0].id;
    console.log(`Correct user ID: ${correctUserId}`);

    // Get all files
    const files = await db.collection('files').find({}).toArray();
    console.log(`Total files: ${files.length}`);

    // Find files with wrong userId
    const wrongUserIdFiles = files.filter(f => f.userId !== correctUserId);
    console.log(`Files with wrong userId: ${wrongUserIdFiles.length}`);

    if (wrongUserIdFiles.length === 0) {
      console.log('\nAll files already have the correct userId!');
      return;
    }

    // Update all files to use the correct userId
    console.log('\nUpdating files...');
    const result = await db.collection('files').updateMany(
      { userId: { $ne: correctUserId } },
      {
        $set: {
          userId: correctUserId,
          updatedAt: new Date().toISOString(),
        },
      }
    );

    console.log(`Updated ${result.modifiedCount} files`);

    // Verify
    const verifyFiles = await db.collection('files').find({ userId: correctUserId }).toArray();
    console.log(`\nFiles now with correct userId: ${verifyFiles.length}`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
