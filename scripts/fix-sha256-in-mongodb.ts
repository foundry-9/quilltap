/**
 * Fix SHA256 Field in MongoDB
 *
 * Fixes the sha256 field in MongoDB file entries that were created with empty strings.
 * The FileEntrySchema requires sha256 to be exactly 64 characters.
 *
 * Usage: npx tsx scripts/fix-sha256-in-mongodb.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';
import {
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

// S3 Configuration
const s3Config = {
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY,
};

// MongoDB Configuration
const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DATABASE || 'quilltap';

async function downloadAndHash(s3Client: S3Client, key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  });

  const response = await s3Client.send(command);
  const body = response.Body;

  if (!body) {
    throw new Error(`No body in S3 response for ${key}`);
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  // Calculate SHA256 hash
  const hash = createHash('sha256').update(buffer).digest('hex');
  return hash;
}

async function main() {
  console.log('=== Fix SHA256 Field in MongoDB ===\n');

  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }

  if (!s3Config.endpoint || !s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey) {
    throw new Error('Missing S3 configuration');
  }

  const mongoClient = new MongoClient(mongoUri);
  const s3Client = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');

    const db = mongoClient.db(mongoDb);
    const filesCollection = db.collection('files');

    // Find files with invalid sha256 (empty string or missing)
    const invalidFiles = await filesCollection.find({
      $or: [
        { sha256: '' },
        { sha256: { $exists: false } },
        { sha256: null },
      ],
    }).toArray();

    console.log(`Found ${invalidFiles.length} files with invalid sha256\n`);

    if (invalidFiles.length === 0) {
      console.log('No files need fixing!');
      return;
    }

    let fixed = 0;
    let errors = 0;

    for (const file of invalidFiles) {
      console.log(`Processing: ${file.id} (${file.originalFilename})`);

      if (!file.s3Key) {
        console.log(`  Skipping: No S3 key`);
        // Use a placeholder hash for files without S3 key
        const placeholderHash = createHash('sha256').update(`placeholder_${file.id}`).digest('hex');
        await filesCollection.updateOne(
          { id: file.id },
          { $set: { sha256: placeholderHash, updatedAt: new Date().toISOString() } }
        );
        console.log(`  Set placeholder hash: ${placeholderHash}`);
        fixed++;
        continue;
      }

      try {
        // Download from S3 and compute actual hash
        console.log(`  Downloading from S3: ${file.s3Key}`);
        const hash = await downloadAndHash(s3Client, file.s3Key);
        console.log(`  Computed hash: ${hash}`);

        // Update MongoDB
        await filesCollection.updateOne(
          { id: file.id },
          { $set: { sha256: hash, updatedAt: new Date().toISOString() } }
        );

        console.log(`  Updated successfully`);
        fixed++;
      } catch (error) {
        console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);

        // Use a placeholder hash if we can't download the file
        const placeholderHash = createHash('sha256').update(`placeholder_${file.id}`).digest('hex');
        await filesCollection.updateOne(
          { id: file.id },
          { $set: { sha256: placeholderHash, updatedAt: new Date().toISOString() } }
        );
        console.log(`  Set placeholder hash: ${placeholderHash}`);
        fixed++;
        errors++;
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total fixed: ${fixed}`);
    console.log(`Download errors (used placeholder): ${errors}`);

  } finally {
    await mongoClient.close();
    console.log('\nMongoDB connection closed');
  }
}

main().catch(console.error);
