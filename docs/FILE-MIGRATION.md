# File System Migration Guide

## Overview

This document describes the migration from the old distributed file system to the new centralized file management system.

## Old System (Pre-Migration)

### Storage Structure
```
public/uploads/
├── images/{userId}/
│   └── {userId}_{timestamp}_{uuid}.{ext}
├── generated/{userId}/
│   └── {userId}_{timestamp}_{index}_{sha256}.{ext}
└── chat-files/{chatId}/
    └── {chatId}_{timestamp}_{uuid}.{ext}

data/binaries/
└── index.jsonl
```

### Issues
- Files scattered across multiple directories
- Complex path management
- Files lost after reboots or deletions
- Difficult to track file relationships
- No centralized metadata management

## New System (Post-Migration)

### Storage Structure
```
data/files/
├── storage/
│   └── {uuid}.{ext}  # All files named by their UUID
└── files.jsonl       # Centralized metadata database
```

### Benefits
- Single source of truth for all files
- UUID-based naming prevents conflicts
- All files under `data/` directory
- Comprehensive metadata tracking
- Better relationship management via `linkedTo` array
- Centralized file database

## File Entry Schema

Each file in `data/files/files.jsonl` contains:

```typescript
{
  // Identity & Storage
  id: string,                    // File UUID (filename in storage)
  sha256: string,                // Content hash for deduplication
  originalFilename: string,      // Original upload name
  mimeType: string,              // Specific MIME type
  size: number,                  // File size in bytes

  // Image metadata (if applicable)
  width?: number,
  height?: number,

  // Relationships
  linkedTo: string[],            // Array of IDs (messageId, chatId, characterId, etc.)

  // Classification
  source: 'UPLOADED' | 'GENERATED' | 'IMPORTED' | 'SYSTEM',
  category: 'IMAGE' | 'DOCUMENT' | 'AVATAR' | 'ATTACHMENT' | 'EXPORT',

  // Generation metadata (for AI-generated files)
  generationPrompt?: string,
  generationModel?: string,
  generationRevisedPrompt?: string,
  description?: string,

  // Tags
  tags: string[],

  // Timestamps
  createdAt: string,
  updatedAt: string,
}
```

## Migration Process

### Step 1: Dry Run

First, perform a dry run to see what will be migrated:

```bash
npm run migrate-files:dry-run
```

This will:
- Read all entries from `data/binaries/index.jsonl`
- Check if files exist in `public/uploads/`
- Show migration statistics
- **Not modify any files**

### Step 2: Backup

Before running the actual migration, backup your data:

```bash
# Backup old files
cp -r public/uploads public/uploads.backup

# Backup old index
cp data/binaries/index.jsonl data/binaries/index.jsonl.backup
```

### Step 3: Run Migration

Run the actual migration:

```bash
npm run migrate-files
```

This will:
- Create `data/files/storage/` directory
- Copy all files from `public/uploads/` to `data/files/storage/{uuid}.{ext}`
- Transform metadata from old to new format
- Create `data/files/files.jsonl` with all file entries
- Preserve file timestamps and metadata

### Step 4: Verify

After migration:

1. Check that `data/files/files.jsonl` was created
2. Verify files in `data/files/storage/` directory
3. Compare file counts with the migration summary
4. Test file access through the application

### Step 5: Update Code

The migration creates new modules alongside the old ones:

- **Old**: `lib/images.ts` → **New**: `lib/images-v2.ts`
- **Old**: `lib/chat-files.ts` → **New**: `lib/chat-files-v2.ts`

Update your imports throughout the codebase:

```typescript
// Before
import { uploadImage } from '@/lib/images';

// After
import { uploadImage } from '@/lib/images-v2';
```

### Step 6: Clean Up (After Testing)

Once you've verified everything works:

```bash
# Remove old uploads directory
rm -rf public/uploads

# Remove old binaries index
rm -rf data/binaries

# Remove old module files (optional)
rm lib/images.ts
rm lib/chat-files.ts
```

## API Changes

### New File Serving Route

Files are now served via:

```
GET /api/files/:id
```

Instead of static file paths like:
```
/uploads/images/{userId}/{filename}
```

### File Upload APIs

Upload APIs now return file IDs instead of paths:

```typescript
// Before
{
  filename: "user_123_avatar.png",
  filepath: "uploads/images/user-123/user_123_avatar.png"
}

// After
{
  id: "550e8400-e29b-41d4-a716-446655440000",
  filename: "avatar.png",
  filepath: "data/files/storage/550e8400-e29b-41d4-a716-446655440000.png"
}
```

## Code Migration

### File Manager Module

The new file manager provides these functions:

```typescript
import {
  createFile,          // Create and store a new file
  findFileById,        // Get file metadata by ID
  findFileByHash,      // Find file by SHA256 hash
  findFilesLinkedTo,   // Get all files linked to an entity
  findFilesByCategory, // Get files by category
  findFilesBySource,   // Get files by source
  readFile,            // Read file as Buffer
  readFileAsBase64,    // Read file as base64
  deleteFile,          // Delete file and metadata
  updateFile,          // Update file metadata
  addFileLink,         // Add entity link to file
  removeFileLink,      // Remove entity link from file
  getFileUrl,          // Get public URL for file
} from '@/lib/file-manager';
```

### Example: Upload Image

```typescript
// Before
import { uploadImage } from '@/lib/images';

const result = await uploadImage(file, userId);
// Returns: { filename, filepath, mimeType, size }

// After
import { uploadImage } from '@/lib/images-v2';

const result = await uploadImage(file, userId, [characterId]);
// Returns: { id, filename, filepath, mimeType, size, sha256 }
```

### Example: Load Chat Files

```typescript
// Before
import { loadChatFilesForLLM } from '@/lib/chat-files';

const files = await loadChatFilesForLLM([
  { id, filepath, filename, mimeType, size }
]);

// After
import { loadChatFilesForLLM } from '@/lib/chat-files-v2';

const files = await loadChatFilesForLLM([fileId1, fileId2]);
```

## Compatibility Layer

A compatibility layer is provided in `lib/file-manager/compat.ts`:

```typescript
import {
  fileEntryToBinaryEntry,  // Convert FileEntry to old format
  getCompatFileUrl,        // Get file URL with extension
  isImageFile,             // Check if file is an image
  isDocumentFile,          // Check if file is a document
  formatFileSize,          // Format bytes as human-readable
  getSourceLabel,          // Get source display label
  getCategoryLabel,        // Get category display label
} from '@/lib/file-manager/compat';
```

## Rollback Procedure

If you need to rollback:

1. Stop the application
2. Restore from backups:
   ```bash
   rm -rf public/uploads
   mv public/uploads.backup public/uploads

   cp data/binaries/index.jsonl.backup data/binaries/index.jsonl
   ```
3. Revert code changes to use old modules
4. Restart the application

## File Deduplication

The new system automatically deduplicates files by SHA256 hash:

- If you upload the same file twice, it's only stored once
- Multiple entities can link to the same file
- When a file is deleted, it checks if any links remain
- Physical file is only deleted when no links exist

## Linked Entities

Files can be linked to multiple entities:

```typescript
{
  linkedTo: [
    "msg-123",      // Message ID
    "chat-456",     // Chat ID
    "char-789",     // Character ID
    "persona-012"   // Persona ID
  ]
}
```

This allows:
- Tracking which messages use which files
- Finding all files in a chat
- Getting character avatars
- Managing persona images

## Migration Statistics

The migration utility provides detailed statistics:

```
Migration Summary
================================================================================
Total files:     156
Migrated:        152
Skipped:         3
Errors:          1

By Category:
  IMAGE           125
  ATTACHMENT       27

By Source:
  UPLOADED         98
  GENERATED        47
  IMPORTED          7
================================================================================
```

## Troubleshooting

### Files not migrating

Check that:
- Old files exist in `public/uploads/`
- File paths in `data/binaries/index.jsonl` are correct
- You have read/write permissions

### Hash mismatches

If SHA256 hashes don't match:
- The file may have been modified since it was uploaded
- Check file integrity
- Migration continues but logs a warning

### Out of disk space

The migration copies files (doesn't move them):
- Ensure you have 2x the space of your current `public/uploads/` directory
- After verification, you can delete old files to free space

## Support

For issues or questions:
- Check the migration logs for detailed error messages
- Review `data/files/files.jsonl` for metadata issues
- File an issue on GitHub with migration statistics and error messages
