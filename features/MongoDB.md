# MongoDB + S3 Migration Plan

This document outlines the complete migration from JSON file-based storage to MongoDB for structured data and S3-compatible storage (MinIO or AWS S3) for binary files in Quilltap.

## Overview

Quilltap currently uses a JSON file-based storage system with:
- JSON files for structured data (users, characters, personas, settings, etc.)
- JSONL (JSON Lines) for append-only logs (chats, sessions)
- Binary file storage in `data/files/storage/`

This migration will:
1. Move structured data to **MongoDB**
2. Move binary files to **S3-compatible storage** (MinIO for self-hosted, AWS S3 for cloud)

Both services support three deployment modes: embedded, Docker sidecar, or external.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Quilltap App                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────┐              ┌─────────────────┐         │
│   │  Repository     │              │   S3 Client     │         │
│   │  Factory        │              │   (AWS SDK)     │         │
│   └────────┬────────┘              └────────┬────────┘         │
│            │                                │                   │
│   ┌────────▼────────┐              ┌────────▼────────┐         │
│   │ MongoDB Driver  │              │ S3 / MinIO      │         │
│   └────────┬────────┘              └────────┬────────┘         │
│            │                                │                   │
└────────────┼────────────────────────────────┼───────────────────┘
             │                                │
    ┌────────▼────────┐              ┌────────▼────────┐
    │    MongoDB      │              │  MinIO / S3     │
    │  (structured)   │              │   (binaries)    │
    └─────────────────┘              └─────────────────┘
```

---

## Deployment Scenarios

### Scenario 1: Basic Dev (Separate Containers)

MongoDB and MinIO run in separate Docker containers alongside the Next.js application.

```yaml
# docker-compose.dev.yml
services:
  app:
    build: .
    environment:
      - DATA_BACKEND=mongodb
      - MONGODB_URI=mongodb://mongo:27017/quilltap
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY=minioadmin
      - S3_SECRET_KEY=minioadmin
      - S3_BUCKET=quilltap-files
    depends_on:
      - mongo
      - minio

  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
    ports:
      - "27017:27017"

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes:
      - minio-data:/data
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Web console
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin

volumes:
  mongo-data:
  minio-data:
```

### Scenario 2: Easy-Hosting (All-in-One Container)

MongoDB and MinIO embedded within the same Docker image as Next.js.

```dockerfile
# Dockerfile.allinone
FROM node:20-alpine

# Install MongoDB
RUN apk add --no-cache mongodb mongodb-tools

# Install MinIO
RUN wget https://dl.min.io/server/minio/release/linux-amd64/minio \
    -O /usr/local/bin/minio && chmod +x /usr/local/bin/minio

# Create data directories
RUN mkdir -p /data/mongodb /data/minio /data/quilltap

# Set environment defaults
ENV DATA_BACKEND=mongodb
ENV MONGODB_MODE=embedded
ENV MONGODB_URI=mongodb://127.0.0.1:27017/quilltap
ENV S3_MODE=embedded
ENV S3_ENDPOINT=http://127.0.0.1:9000
ENV S3_ACCESS_KEY=quilltap
ENV S3_SECRET_KEY=quilltap-secret-key
ENV S3_BUCKET=quilltap-files

# Copy application
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Copy startup script
COPY docker/start-allinone.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 3000

VOLUME ["/data"]

CMD ["/start.sh"]
```

**Startup Script:**
```bash
#!/bin/sh
# docker/start-allinone.sh
set -e

# Start MongoDB
echo "Starting MongoDB..."
mkdir -p /data/mongodb
mongod --dbpath /data/mongodb --bind_ip 127.0.0.1 --fork --logpath /var/log/mongodb.log

until mongosh --eval "db.runCommand('ping').ok" --quiet; do
  echo "Waiting for MongoDB..."
  sleep 1
done
echo "MongoDB started"

# Start MinIO
echo "Starting MinIO..."
mkdir -p /data/minio
MINIO_ROOT_USER=${S3_ACCESS_KEY} MINIO_ROOT_PASSWORD=${S3_SECRET_KEY} \
  minio server /data/minio --address 127.0.0.1:9000 &

until wget -q --spider http://127.0.0.1:9000/minio/health/ready; do
  echo "Waiting for MinIO..."
  sleep 1
done
echo "MinIO started"

# Create default bucket if it doesn't exist
mc alias set local http://127.0.0.1:9000 ${S3_ACCESS_KEY} ${S3_SECRET_KEY}
mc mb --ignore-existing local/${S3_BUCKET}

echo "Starting Quilltap..."
exec node server.js
```

### Scenario 3: External Services (AWS / Cloud)

Connect to external MongoDB (Atlas) and AWS S3.

```env
# .env.production
DATA_BACKEND=mongodb

# MongoDB Atlas
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/quilltap?retryWrites=true&w=majority
MONGODB_DATABASE=quilltap

# AWS S3
S3_MODE=external
S3_REGION=us-east-1
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET=my-quilltap-files
# S3_ENDPOINT not set = use AWS S3
```

---

## Environment Variables

### MongoDB Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATA_BACKEND` | Backend type: `json`, `mongodb`, or `dual` | `json` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `MONGODB_DATABASE` | Database name | `quilltap` |
| `MONGODB_MODE` | `external` or `embedded` | `external` |
| `MONGODB_DATA_DIR` | Data directory for embedded mode | `/data/mongodb` |
| `MONGODB_CONNECTION_TIMEOUT_MS` | Connection timeout | `10000` |
| `MONGODB_MAX_POOL_SIZE` | Connection pool size | `10` |

### S3 / MinIO Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_MODE` | `embedded`, `external`, or `disabled` | `disabled` |
| `S3_ENDPOINT` | S3-compatible endpoint URL | (AWS S3 if not set) |
| `S3_REGION` | AWS region (for AWS S3) | `us-east-1` |
| `S3_ACCESS_KEY` | Access key ID | - |
| `S3_SECRET_KEY` | Secret access key | - |
| `S3_BUCKET` | Bucket name for files | `quilltap-files` |
| `S3_PATH_PREFIX` | Optional prefix for all keys | - |
| `S3_PUBLIC_URL` | Public URL for serving files (CDN) | - |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs (required for MinIO) | `true` if endpoint set |

---

## Data Model Design

### MongoDB Collections

File metadata is stored in MongoDB; binary content is stored in S3.

#### Core Collections

| Collection | Current Source | Document Structure |
|------------|----------------|-------------------|
| `users` | `settings/general.json` | User object with embedded settings |
| `accounts` | `auth/accounts.json` | NextAuth OAuth accounts |
| `sessions` | `auth/sessions.jsonl` | NextAuth sessions |
| `verification_tokens` | `auth/verification-tokens.jsonl` | Email verification tokens |

#### User Content Collections

| Collection | Current Source | Document Structure |
|------------|----------------|-------------------|
| `characters` | `characters/{id}.json` | Character with embedded tags |
| `personas` | `personas/{id}.json` | Persona with embedded tags |
| `chats` | `chats/index.jsonl` + `chats/{id}.jsonl` | Chat metadata + messages array |
| `memories` | `memories/by-character/{id}.json` | Memory documents per character |
| `tags` | `tags/tags.json` | Tag definitions |

#### Settings Collections

| Collection | Current Source | Document Structure |
|------------|----------------|-------------------|
| `connection_profiles` | `settings/connection-profiles.json` | LLM connection profiles |
| `api_keys` | (embedded in connection profiles) | Encrypted API keys |
| `image_profiles` | `settings/image-profiles.json` | Image generation profiles |
| `embedding_profiles` | `settings/embedding-profiles.json` | Embedding model profiles |

#### File Management (Hybrid)

| Storage | What | Structure |
|---------|------|-----------|
| MongoDB `files` | Metadata | FileEntry document with S3 key reference |
| S3 Bucket | Binary content | Objects keyed by `{userId}/{fileId}/{filename}` |

### File Schema

```typescript
// lib/mongodb/schemas/file.schema.ts
interface MongoFile {
  _id: ObjectId;
  id: string;           // UUID
  userId: string;       // Owner reference
  filename: string;     // Original filename
  mimeType: string;
  size: number;         // Bytes
  sha256: string;       // Content hash for deduplication
  source: 'upload' | 'generated' | 'url';
  category: 'image' | 'document' | 'other';
  tags: string[];
  metadata?: Record<string, unknown>;

  // S3 storage reference
  s3Key: string;        // Full S3 object key
  s3Bucket: string;     // Bucket name (for multi-bucket setups)

  // Optional CDN/public URL
  publicUrl?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

### S3 Key Structure

```
{bucket}/
├── users/
│   └── {userId}/
│       ├── avatars/
│       │   └── {fileId}.{ext}
│       ├── uploads/
│       │   └── {fileId}.{ext}
│       └── generated/
│           └── {fileId}.{ext}
└── system/
    └── defaults/
        └── default-avatar.png
```

---

## S3 Client Implementation

### S3 Client Module

**File:** `lib/s3/client.ts`

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@/lib/logger';

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3_ACCESS_KEY and S3_SECRET_KEY are required');
  }

  s3Client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: !!endpoint,  // Required for MinIO
  });

  logger.info('S3 client initialized', { endpoint: endpoint || 'AWS S3', region });
  return s3Client;
}

export function getS3Bucket(): string {
  return process.env.S3_BUCKET || 'quilltap-files';
}

export function buildS3Key(userId: string, fileId: string, filename: string, category: string): string {
  const prefix = process.env.S3_PATH_PREFIX || '';
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${prefix}users/${userId}/${category}/${fileId}_${safeFilename}`.replace(/^\//, '');
}
```

### S3 Operations

**File:** `lib/s3/operations.ts`

```typescript
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, getS3Bucket } from './client';
import { Readable } from 'stream';

export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string,
  metadata?: Record<string, string>
): Promise<void> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
  }));
}

export async function downloadFile(key: string): Promise<Buffer> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));

  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(key: string): Promise<void> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }), { expiresIn });
}

export async function getPublicUrl(key: string): Promise<string> {
  const publicUrl = process.env.S3_PUBLIC_URL;
  if (publicUrl) {
    return `${publicUrl}/${key}`;
  }
  // Fall back to presigned URL
  return getPresignedUrl(key);
}
```

### S3 Configuration Validator

**File:** `lib/s3/config.ts`

```typescript
export interface S3Config {
  mode: 'embedded' | 'external' | 'disabled';
  endpoint?: string;
  region: string;
  bucket: string;
  isConfigured: boolean;
  errors: string[];
}

export function validateS3Config(): S3Config {
  const errors: string[] = [];
  const mode = (process.env.S3_MODE || 'disabled') as S3Config['mode'];
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'us-east-1';
  const bucket = process.env.S3_BUCKET || 'quilltap-files';
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;

  if (mode !== 'disabled') {
    if (!accessKey) errors.push('S3_ACCESS_KEY is required');
    if (!secretKey) errors.push('S3_SECRET_KEY is required');
    if (mode === 'external' && !endpoint && !region) {
      errors.push('S3_REGION is required for AWS S3');
    }
  }

  return {
    mode,
    endpoint,
    region,
    bucket,
    isConfigured: mode === 'disabled' || errors.length === 0,
    errors,
  };
}

export async function testS3Connection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  const config = validateS3Config();
  if (config.mode === 'disabled') {
    return { success: true, message: 'S3 storage disabled' };
  }
  if (!config.isConfigured) {
    return { success: false, message: config.errors.join(', ') };
  }

  const start = Date.now();
  try {
    const client = getS3Client();
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return {
      success: true,
      message: 'S3 connection successful',
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return { success: false, message: `Bucket '${config.bucket}' does not exist` };
    }
    return {
      success: false,
      message: error.message || 'Unknown error',
    };
  }
}
```

---

## Implementation Phases

### Phase 1: Infrastructure Setup ✅ COMPLETE

**Completed:** December 4, 2025

1. **MongoDB Client** (`lib/mongodb/client.ts`) ✅
   - Singleton connection management with `getMongoClient()` and `getMongoDatabase()`
   - Configuration validation via Zod schema
   - Connection testing with `testMongoDBConnection()`
   - Graceful shutdown handlers with `setupMongoDBShutdownHandlers()`
   - Event listeners for connection lifecycle

2. **MongoDB Configuration** (`lib/mongodb/config.ts`) ✅
   - Zod schema validation for all MongoDB environment variables
   - `validateMongoDBConfig()` returns config object with `isConfigured` and `errors`
   - `testMongoDBConnection()` with latency measurement
   - URI sanitization for safe logging

3. **S3 Client** (`lib/s3/client.ts`) ✅
   - AWS SDK v3 singleton pattern
   - MinIO compatibility with `forcePathStyle`
   - `getS3Client()`, `getS3Bucket()`, `buildS3Key()` utilities
   - `testS3Connection()` with bucket existence check

4. **S3 Configuration** (`lib/s3/config.ts`) ✅
   - Zod schema validation for all S3 environment variables
   - Support for `embedded`, `external`, and `disabled` modes
   - `validateS3Config()` with `isConfigured` and `errors`
   - `isS3Enabled()` helper function

5. **S3 Operations** (`lib/s3/operations.ts`) ✅
   - `uploadFile()`, `downloadFile()`, `deleteFile()`
   - `fileExists()`, `getFileMetadata()`
   - `getPresignedUrl()`, `getPresignedUploadUrl()`, `getPublicUrl()`
   - `listFiles()` for prefix-based listing

6. **Index Definitions** (`lib/mongodb/indexes.ts`) ✅
   - Comprehensive indexes for all 10 collections
   - `ensureIndexes(db)` for startup index creation
   - `dropIndexes(db)` for testing/reset

7. **Environment Variables** ✅
   - Updated `lib/env.ts` with MongoDB and S3 Zod schemas
   - Updated `.env.example` with documentation for all new variables

8. **Startup Integration** (`lib/startup/index.ts`) ✅
   - `initializeMongoDBIfNeeded()` - conditional MongoDB startup
   - `initializeS3IfNeeded()` - conditional S3 startup
   - `initializeAllServices()` - parallel service initialization

9. **Dependencies** (`package.json`) ✅
   - `mongodb@^6.21.0`
   - `@aws-sdk/client-s3@^3.943.0`
   - `@aws-sdk/s3-request-presigner@^3.943.0`

### Phase 2: Repository Layer ✅ COMPLETE

**Completed:** December 4, 2025

1. **MongoDB Repositories** (`lib/mongodb/repositories/`) ✅
   - Base repository with MongoDB collection management
   - All entity repositories (characters, personas, chats, tags, users, etc.)
   - Files repository with S3 reference management

2. **S3 File Service** (`lib/s3/file-service.ts`) ✅
   - `uploadUserFile()`, `downloadUserFile()`, `deleteUserFile()`
   - `getFileUrl()` with presigned URL option
   - `generatePresignedUploadUrl()` for direct uploads
   - `listUserFiles()` for prefix-based listing
   - `uploadWithMetadata()` for full metadata support

3. **Repository Factory** (`lib/repositories/factory.ts`) ✅
   - Backend-agnostic interface with `DATA_BACKEND` switching
   - JSON/MongoDB mode selection
   - Singleton pattern for repository container

### Phase 3: Migration System ✅ COMPLETE

**Completed:** December 4, 2025

1. **Pre-flight Validation** ✅
   - `validate-mongodb-config-v1`: Validates MongoDB connectivity and configuration
   - `validate-s3-config-v1`: Validates S3 connectivity and bucket access

2. **Data Migration** ✅
   - `migrate-json-to-mongodb-v1`: Migrates all structured data (tags, users, connections, image profiles, embedding profiles, personas, characters, memories, chats, images)
   - `migrate-files-to-s3-v1`: Migrates binary files from local storage to S3, updates file entries with S3 references

3. **Migration Registry** (`plugins/dist/qtap-plugin-upgrade/migrations/index.ts`) ✅
   - All 4 migrations registered and exported
   - Proper dependency ordering (validation before data migration)

4. **Schema Updates** ✅
   - `FileEntry` type updated with `s3Key` and `s3Bucket` optional fields

### Phase 4: Docker Configurations ✅ COMPLETE

**Completed:** December 4, 2025

1. **Development Compose** (`docker-compose.dev-mongo.yml`) ✅
   - MongoDB and MinIO in separate containers
   - Healthchecks with proper conditions
   - Volume mounts for data persistence
   - Auto bucket creation via minio/mc
   - Optional mongo-express admin UI

2. **All-in-One Dockerfile** (`Dockerfile.allinone`) ✅
   - Embedded MongoDB and MinIO in single container
   - tini init process for proper signal handling
   - Startup script for orchestration

3. **Startup Script** (`docker/start-allinone.sh`) ✅
   - MongoDB startup with readiness check
   - MinIO startup with health verification
   - Automatic bucket creation
   - Proper signal forwarding via exec

4. **Production Compose** (`docker-compose.prod-cloud.yml`) ✅
   - External MongoDB Atlas + AWS S3 configuration
   - Environment variable substitution
   - Health check endpoint monitoring

### Phase 5: Integration ✅ COMPLETE

**Completed:** December 4, 2025

1. **NextAuth MongoDB Adapter** (`lib/mongodb/auth-adapter.ts`) ✅
   - Full adapter interface implementation
   - User, Account, Session, and VerificationToken management
   - Proper ObjectId conversion
   - Comprehensive debug logging

2. **Health Check Endpoint** (`app/api/health/route.ts`) ✅
   - Multi-service health checks (JSON, MongoDB, S3)
   - Latency measurement for each service
   - Status levels: healthy, degraded, unhealthy
   - Backwards compatible with JSON-only deployments

3. **File Serving API** (`app/api/files/[id]/route.ts`) ✅
   - S3 file serving with presigned URLs for large files
   - Direct download for small files (<5MB)
   - Graceful fallback to local filesystem
   - S3 deletion in DELETE handler

---

## Migration Details

### Pre-Migration Validation

**File:** `plugins/dist/qtap-plugin-upgrade/migrations/validate-s3-config.ts`

```typescript
export const validateS3ConfigMigration: Migration = {
  id: 'validate-s3-config-v1',
  description: 'Validate S3 configuration before file migration',
  introducedInVersion: '2.0.0',

  async shouldRun(): Promise<boolean> {
    const s3Config = validateS3Config();
    return s3Config.mode !== 'disabled';
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const config = validateS3Config();

    if (!config.isConfigured) {
      return {
        id: 'validate-s3-config-v1',
        success: false,
        itemsAffected: 0,
        message: 'S3 configuration is incomplete',
        error: config.errors.join('; '),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const connectionTest = await testS3Connection();
    if (!connectionTest.success) {
      return {
        id: 'validate-s3-config-v1',
        success: false,
        itemsAffected: 0,
        message: 'S3 connection failed',
        error: connectionTest.message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      id: 'validate-s3-config-v1',
      success: true,
      itemsAffected: 1,
      message: `S3 connection verified (${connectionTest.latencyMs}ms latency)`,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
```

### File Migration to S3

**File:** `plugins/dist/qtap-plugin-upgrade/migrations/migrate-files-to-s3.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { uploadFile, buildS3Key } from '@/lib/s3/operations';
import { getRepositories as getJsonRepos } from '@/lib/json-store/repositories';

export const migrateFilesToS3Migration: Migration = {
  id: 'migrate-files-to-s3-v1',
  description: 'Migrate binary files from local storage to S3',
  introducedInVersion: '2.0.0',
  dependsOn: ['validate-s3-config-v1', 'migrate-json-to-mongodb-v1'],

  async shouldRun(): Promise<boolean> {
    const s3Config = validateS3Config();
    if (s3Config.mode === 'disabled') return false;

    // Check if local files exist that haven't been migrated
    const dataDir = process.env.DATA_DIR || './data';
    const storageDir = path.join(dataDir, 'files', 'storage');
    try {
      const files = await fs.readdir(storageDir);
      return files.length > 0;
    } catch {
      return false;
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let filesUploaded = 0;
    const errors: string[] = [];

    const jsonRepos = getJsonRepos();
    const dataDir = process.env.DATA_DIR || './data';
    const storageDir = path.join(dataDir, 'files', 'storage');

    try {
      const fileEntries = await jsonRepos.files.findAll();

      for (const fileEntry of fileEntries) {
        try {
          const localPath = path.join(storageDir, fileEntry.id);
          const content = await fs.readFile(localPath);

          const s3Key = buildS3Key(
            fileEntry.userId || 'system',
            fileEntry.id,
            fileEntry.filename,
            fileEntry.category || 'uploads'
          );

          await uploadFile(s3Key, content, fileEntry.mimeType);

          // Update file entry with S3 reference
          await updateFileWithS3Key(fileEntry.id, s3Key);

          filesUploaded++;
          logger.debug(`Migrated file ${fileEntry.id} to S3`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(`${fileEntry.id}: ${msg}`);
          logger.error(`Failed to migrate file ${fileEntry.id}`, { error: msg });
        }
      }

      return {
        id: 'migrate-files-to-s3-v1',
        success: errors.length === 0,
        itemsAffected: filesUploaded,
        message: `Migrated ${filesUploaded} files to S3`,
        error: errors.length > 0 ? errors.slice(0, 5).join('; ') : undefined,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        id: 'migrate-files-to-s3-v1',
        success: false,
        itemsAffected: filesUploaded,
        message: 'File migration failed',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
```

---

## Docker Configurations

### Development with Separate Containers

**File:** `docker-compose.dev-mongo.yml`

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATA_BACKEND=mongodb
      - MONGODB_URI=mongodb://mongo:27017/quilltap
      - MONGODB_DATABASE=quilltap
      - S3_MODE=external
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY=minioadmin
      - S3_SECRET_KEY=minioadmin
      - S3_BUCKET=quilltap-files
    depends_on:
      mongo:
        condition: service_healthy
      minio:
        condition: service_healthy
    volumes:
      - ./:/app
      - /app/node_modules
      - ./data:/app/data

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: mongosh --eval 'db.runCommand("ping").ok' --quiet
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/ready"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Optional: MinIO Console for debugging
  createbuckets:
    image: minio/mc
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set myminio http://minio:9000 minioadmin minioadmin;
      mc mb --ignore-existing myminio/quilltap-files;
      exit 0;
      "

  # Optional: MongoDB admin UI
  mongo-express:
    image: mongo-express
    ports:
      - "8081:8081"
    environment:
      - ME_CONFIG_MONGODB_URL=mongodb://mongo:27017
    depends_on:
      - mongo

volumes:
  mongo-data:
  minio-data:
```

### Production with External Services

**File:** `docker-compose.prod-cloud.yml`

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: always
    ports:
      - "3000:3000"
    environment:
      - DATA_BACKEND=mongodb
      - MONGODB_URI=${MONGODB_URI}
      - MONGODB_DATABASE=${MONGODB_DATABASE:-quilltap}
      - S3_MODE=external
      - S3_REGION=${S3_REGION:-us-east-1}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY}
      - S3_SECRET_KEY=${S3_SECRET_KEY}
      - S3_BUCKET=${S3_BUCKET:-quilltap-files}
      - S3_PUBLIC_URL=${S3_PUBLIC_URL}
      - NEXTAUTH_URL=${NEXTAUTH_URL}
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - ENCRYPTION_MASTER_PEPPER=${ENCRYPTION_MASTER_PEPPER}
    healthcheck:
      test: wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## API Updates

### File Serving Endpoint

**File:** `app/api/files/[id]/route.ts`

Update to support S3 backend:

```typescript
import { getRepositories } from '@/lib/repositories/factory';
import { downloadFile, getPresignedUrl, getPublicUrl } from '@/lib/s3/operations';
import { validateS3Config } from '@/lib/s3/config';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const repos = getRepositories();
  const file = await repos.files.findById(params.id);

  if (!file) {
    return new Response('Not found', { status: 404 });
  }

  const s3Config = validateS3Config();

  // If S3 is enabled and file has S3 key, serve from S3
  if (s3Config.mode !== 'disabled' && file.s3Key) {
    // Option 1: Redirect to presigned URL (recommended for large files)
    const url = await getPresignedUrl(file.s3Key);
    return Response.redirect(url, 302);

    // Option 2: Proxy through server (for small files or when hiding S3)
    // const content = await downloadFile(file.s3Key);
    // return new Response(content, {
    //   headers: {
    //     'Content-Type': file.mimeType,
    //     'Content-Length': file.size.toString(),
    //   },
    // });
  }

  // Fall back to local file system
  const localPath = path.join(process.env.DATA_DIR || './data', 'files', 'storage', file.id);
  const content = await fs.readFile(localPath);
  return new Response(content, {
    headers: { 'Content-Type': file.mimeType },
  });
}
```

### Health Check Endpoint

**File:** `app/api/health/route.ts`

```typescript
import { testMongoDBConnection, validateMongoDBConfig } from '@/lib/mongodb/config';
import { testS3Connection, validateS3Config } from '@/lib/s3/config';

export async function GET() {
  const health: Record<string, any> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {},
  };

  const backend = process.env.DATA_BACKEND || 'json';

  // MongoDB health
  if (backend === 'mongodb' || backend === 'dual') {
    const mongoConfig = validateMongoDBConfig();
    const mongoTest = mongoConfig.isConfigured
      ? await testMongoDBConnection()
      : { success: false, message: mongoConfig.errors.join(', ') };

    health.services.mongodb = {
      status: mongoTest.success ? 'ok' : 'error',
      latencyMs: mongoTest.latencyMs,
      message: mongoTest.message,
    };

    if (!mongoTest.success) health.status = 'degraded';
  }

  // S3 health
  const s3Config = validateS3Config();
  if (s3Config.mode !== 'disabled') {
    const s3Test = await testS3Connection();

    health.services.s3 = {
      status: s3Test.success ? 'ok' : 'error',
      latencyMs: s3Test.latencyMs,
      message: s3Test.message,
      mode: s3Config.mode,
    };

    if (!s3Test.success) health.status = 'degraded';
  }

  return Response.json(health, {
    status: health.status === 'ok' ? 200 : 503,
  });
}
```

---

## Files to Create

```
lib/mongodb/
├── client.ts
├── config.ts
├── indexes.ts
├── auth-adapter.ts
├── schemas/
│   ├── user.schema.ts
│   ├── character.schema.ts
│   ├── chat.schema.ts
│   └── file.schema.ts
└── repositories/
    ├── base.repository.ts
    ├── users.repository.ts
    ├── characters.repository.ts
    ├── personas.repository.ts
    ├── chats.repository.ts
    ├── memories.repository.ts
    ├── tags.repository.ts
    ├── connection-profiles.repository.ts
    ├── image-profiles.repository.ts
    ├── embedding-profiles.repository.ts
    └── files.repository.ts

lib/s3/
├── client.ts
├── config.ts
├── operations.ts
└── file-service.ts

lib/repositories/
└── factory.ts

plugins/dist/qtap-plugin-upgrade/migrations/
├── validate-mongodb-config.ts
├── validate-s3-config.ts
├── migrate-json-to-mongodb.ts
└── migrate-files-to-s3.ts

docker/
├── start-allinone.sh
├── docker-compose.dev-mongo.yml
├── docker-compose.prod-cloud.yml
└── Dockerfile.allinone
```

## Files to Modify

- `.env.example` - Add MongoDB and S3 environment variables
- `lib/startup/index.ts` - Add MongoDB and S3 initialization
- `app/api/health/route.ts` - Add service health checks
- `app/api/files/[id]/route.ts` - S3 file serving
- `package.json` - Add dependencies

---

## Dependencies

```json
{
  "dependencies": {
    "mongodb": "^6.3.0",
    "@aws-sdk/client-s3": "^3.500.0",
    "@aws-sdk/s3-request-presigner": "^3.500.0"
  }
}
```

---

## Success Criteria

1. **Basic Dev**: `docker-compose -f docker-compose.dev-mongo.yml up` starts app with MongoDB + MinIO
2. **Easy-Hosting**: Single Docker image runs MongoDB + MinIO + Next.js
3. **External Services**: Connect to MongoDB Atlas + AWS S3
4. **Migration**: Automatic migration when `DATA_BACKEND=mongodb` and `S3_MODE=external`
5. **Files**: All binary files properly stored in S3 with metadata in MongoDB
6. **Rollback**: Can switch back to JSON backend without data loss
7. **Performance**: Fast file access via presigned URLs or CDN

---

## MinIO vs AWS S3 Compatibility

MinIO is fully S3-compatible. Key differences:

| Feature | MinIO | AWS S3 |
|---------|-------|--------|
| Endpoint | Custom URL required | Not needed (uses AWS default) |
| Path style | Required (`forcePathStyle: true`) | Optional |
| Authentication | Access/Secret keys | IAM roles, access keys |
| Bucket creation | Manual or via mc CLI | Console, CLI, or SDK |
| CORS | Configure via mc | Configure via Console/SDK |
| Public access | Configure bucket policy | Bucket policy or ACLs |

The AWS SDK v3 handles both seamlessly with the configuration options we provide.

---

## Version Target

This feature is targeted for Quilltap v2.0.0.
