/**
 * Reset File Tags Script
 *
 * Lists all files from S3 and resets their tags/linkedTo in MongoDB
 * so they appear as "general" gallery images ready for retagging.
 *
 * Usage: npx tsx scripts/reset-file-tags.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { MongoClient } from 'mongodb';
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

// S3 Configuration (supports both naming conventions)
const s3Config = {
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY,
  pathPrefix: process.env.S3_PATH_PREFIX || '',
};

// MongoDB Configuration
const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DATABASE || 'quilltap';

interface S3FileInfo {
  key: string;
  size: number;
  lastModified: Date;
  metadata?: Record<string, string>;
  fileId?: string;
  userId?: string;
  category?: string;
  filename?: string;
}

async function listAllS3Files(): Promise<S3FileInfo[]> {
  console.log('\n=== Listing S3 Files ===');
  console.log(`Endpoint: ${s3Config.endpoint}`);
  console.log(`Bucket: ${s3Config.bucket}`);
  console.log(`Path Prefix: ${s3Config.pathPrefix || '(none)'}`);

  if (!s3Config.endpoint || !s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey) {
    throw new Error('Missing S3 configuration. Check S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  }

  const client = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
    forcePathStyle: true, // Required for MinIO
  });

  const files: S3FileInfo[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: s3Config.bucket,
      Prefix: s3Config.pathPrefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });

    const response = await client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Size !== undefined) {
          // Get metadata for this file
          try {
            const headCommand = new HeadObjectCommand({
              Bucket: s3Config.bucket,
              Key: obj.Key,
            });
            const headResponse = await client.send(headCommand);

            const metadata = headResponse.Metadata || {};

            files.push({
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified || new Date(),
              metadata,
              fileId: metadata.fileid || metadata.fileId,
              userId: metadata.userid || metadata.userId,
              category: metadata.category,
              filename: metadata.filename,
            });
          } catch (error) {
            console.warn(`  Warning: Could not get metadata for ${obj.Key}`);
            files.push({
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified || new Date(),
            });
          }
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return files;
}

/**
 * Parse S3 key to extract file info
 * Key format: users/{userId}/{category}/{fileId}_{filename}
 */
function parseS3Key(key: string): { userId: string; category: string; fileId: string; filename: string } | null {
  // Match: users/{userId}/{category}/{fileId}_{filename}
  const match = /^users\/([^/]+)\/([^/]+)\/([a-f0-9-]{36})_(.+)$/.exec(key);
  if (match) {
    return {
      userId: match[1],
      category: match[2].toUpperCase(), // image -> IMAGE
      fileId: match[3],
      filename: match[4],
    };
  }
  return null;
}

/**
 * Determine file source from filename
 */
function determineFileSource(filename: string): string {
  if (filename.startsWith('generated_')) {
    return 'GENERATED';
  }
  if (filename.startsWith('Gemini_Generated_')) {
    return 'GENERATED';
  }
  return 'UPLOADED';
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

async function resetMongoDBFileTags(s3Files: S3FileInfo[]): Promise<void> {
  console.log('\n=== Syncing S3 Files to MongoDB ===');
  console.log(`MongoDB URI: ${mongoUri?.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);
  console.log(`Database: ${mongoDb}`);

  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(mongoDb);
    const filesCollection = db.collection('files');

    // Get all files from MongoDB
    const mongoFiles = await filesCollection.find({}).toArray();
    console.log(`\nFound ${mongoFiles.length} files in MongoDB`);

    // Parse S3 files and create lookup
    const s3FilesMap = new Map<string, { s3File: S3FileInfo; parsed: ReturnType<typeof parseS3Key> }>();
    for (const s3File of s3Files) {
      const parsed = parseS3Key(s3File.key);
      if (parsed) {
        s3FilesMap.set(parsed.fileId, { s3File, parsed });
      }
    }

    console.log(`\nIdentified ${s3FilesMap.size} parseable files from S3`);

    // Report on files
    let matchedCount = 0;
    let orphanedMongoCount = 0;
    const orphanedS3Files: Array<{ s3File: S3FileInfo; parsed: NonNullable<ReturnType<typeof parseS3Key>> }> = [];

    const mongoFileIds = new Set(mongoFiles.map(f => f.id));

    for (const mongoFile of mongoFiles) {
      if (s3FilesMap.has(mongoFile.id)) {
        matchedCount++;
      } else {
        orphanedMongoCount++;
        console.log(`  MongoDB file without S3: ${mongoFile.id} (${mongoFile.originalFilename})`);
      }
    }

    for (const [fileId, data] of s3FilesMap.entries()) {
      if (!mongoFileIds.has(fileId)) {
        orphanedS3Files.push({ s3File: data.s3File, parsed: data.parsed! });
        console.log(`  S3 file without MongoDB: ${fileId} (${data.s3File.key})`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`S3 Files: ${s3Files.length}`);
    console.log(`MongoDB Files: ${mongoFiles.length}`);
    console.log(`Matched: ${matchedCount}`);
    console.log(`Orphaned in MongoDB (no S3): ${orphanedMongoCount}`);
    console.log(`Orphaned in S3 (no MongoDB): ${orphanedS3Files.length}`);

    // Create MongoDB entries for orphaned S3 files
    if (orphanedS3Files.length > 0) {
      console.log(`\n=== Creating MongoDB Entries for Orphaned S3 Files ===`);

      for (const { s3File, parsed } of orphanedS3Files) {
        const now = new Date().toISOString();
        const fileEntry = {
          id: parsed.fileId,
          userId: parsed.userId,
          sha256: '', // Unknown - would need to download and hash
          originalFilename: parsed.filename,
          mimeType: getMimeType(parsed.filename),
          size: s3File.size,
          linkedTo: [],
          tags: [],
          source: determineFileSource(parsed.filename),
          category: parsed.category,
          s3Key: s3File.key,
          s3Bucket: s3Config.bucket,
          createdAt: s3File.lastModified.toISOString(),
          updatedAt: now,
        };

        await filesCollection.insertOne(fileEntry);
        console.log(`  Created: ${parsed.fileId} (${parsed.filename})`);
      }

      console.log(`Created ${orphanedS3Files.length} MongoDB file entries`);
    }

    // Reset tags and linkedTo for ALL files that have s3Key (i.e., are in S3)
    console.log(`\n=== Resetting Tags ===`);

    const result = await filesCollection.updateMany(
      { s3Key: { $exists: true, $ne: null } },
      {
        $set: {
          tags: [],
          linkedTo: [],
          updatedAt: new Date().toISOString(),
        },
      }
    );

    console.log(`Updated ${result.modifiedCount} files (cleared tags and linkedTo)`);

    // Show final state
    const updatedFiles = await filesCollection.find({ s3Key: { $exists: true, $ne: null } }).toArray();
    console.log(`\n=== Files After Sync ===`);
    for (const file of updatedFiles) {
      console.log(`  ${file.id}: ${file.originalFilename}`);
      console.log(`    Category: ${file.category}, Source: ${file.source}`);
      console.log(`    Tags: ${JSON.stringify(file.tags)}, LinkedTo: ${JSON.stringify(file.linkedTo)}`);
    }

  } finally {
    await client.close();
    console.log('\nMongoDB connection closed');
  }
}

async function main() {
  console.log('=== File Tags Reset Script ===');
  console.log('This script will:');
  console.log('1. List all files in S3');
  console.log('2. Clear tags and linkedTo arrays in MongoDB for S3 files');
  console.log('3. Show a summary of the changes\n');

  try {
    // List S3 files
    const s3Files = await listAllS3Files();
    console.log(`\nFound ${s3Files.length} files in S3:`);
    for (const file of s3Files) {
      console.log(`  ${file.key}`);
      console.log(`    Size: ${file.size}, FileId: ${file.fileId || 'unknown'}`);
    }

    // Reset MongoDB
    await resetMongoDBFileTags(s3Files);

    console.log('\n=== Done ===');
    console.log('All S3 files should now appear in the general gallery without tags.');
    console.log('You can re-tag them through the UI.');

  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main();
