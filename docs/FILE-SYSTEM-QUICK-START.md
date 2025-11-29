# File System Quick Start Guide

## TL;DR

Run these commands to migrate to the new centralized file system:

```bash
# 1. Preview what will happen (safe, no changes)
npm run migrate-files:dry-run

# 2. Backup your data
cp -r public/uploads public/uploads.backup
cp data/binaries/index.jsonl data/binaries/index.jsonl.backup

# 3. Run the migration
npm run migrate-files

# 4. Verify it worked
ls -la data/files/storage/
cat data/files/files.jsonl | wc -l
```

## What Changed

### File Locations

**Before**: Files scattered across `public/uploads/images/`, `public/uploads/generated/`, `public/uploads/chat-files/`

**After**: All files in `data/files/storage/{uuid}.{ext}`

### File Tracking

**Before**: `data/binaries/index.jsonl` with limited metadata

**After**: `data/files/files.jsonl` with comprehensive metadata including:
- Relationships (`linkedTo` array)
- Source tracking (uploaded/generated/imported)
- Category classification
- Generation metadata for AI files
- Content hash for deduplication

## Code Changes

### Update Imports

```typescript
// OLD - Remove these
import { uploadImage } from '@/lib/images';
import { uploadChatFile } from '@/lib/chat-files';

// NEW - Use these instead
import { uploadImage } from '@/lib/images-v2';
import { uploadChatFile } from '@/lib/chat-files-v2';
```

### Using the File Manager

```typescript
import { createFile, findFileById } from '@/lib/file-manager';

// Create a file
const file = await createFile({
  buffer: myFileBuffer,
  originalFilename: 'image.png',
  mimeType: 'image/png',
  source: 'UPLOADED',
  category: 'IMAGE',
  linkedTo: [chatId, characterId],
});

// Get a file
const fileData = await findFileById(file.id);
```

## API Changes

### Old Way
```
GET /uploads/images/user-123/avatar.png
```

### New Way
```
GET /api/files/550e8400-e29b-41d4-a716-446655440000
```

## Common Tasks

### Upload an Image
```typescript
import { uploadImage } from '@/lib/images-v2';

const result = await uploadImage(file, userId, [characterId]);
// Returns: { id, filename, filepath, mimeType, size, sha256 }
```

### Upload a Chat File
```typescript
import { uploadChatFile } from '@/lib/chat-files-v2';

const result = await uploadChatFile(file, chatId, messageId);
// Returns: { id, filename, filepath, mimeType, size, sha256 }
```

### Find Files for a Chat
```typescript
import { findFilesLinkedTo } from '@/lib/file-manager';

const files = await findFilesLinkedTo(chatId);
```

### Delete a File
```typescript
import { deleteFile, findFileById } from '@/lib/file-manager';

const file = await findFileById(fileId);
if (file.linkedTo.length === 0) {
  await deleteFile(fileId);
}
```

## Migration Checklist

- [ ] Run dry-run migration
- [ ] Review migration statistics
- [ ] Backup `public/uploads` and `data/binaries/`
- [ ] Run actual migration
- [ ] Verify file count matches
- [ ] Update code imports to use `-v2` modules
- [ ] Test file uploads
- [ ] Test file downloads
- [ ] Test file deletion
- [ ] Test image generation
- [ ] Deploy to production
- [ ] After 1 week, remove old backups

## Rollback (If Needed)

```bash
# Stop the app
# Restore backups
mv public/uploads.backup public/uploads
cp data/binaries/index.jsonl.backup data/binaries/index.jsonl

# Revert code changes
git checkout lib/images-v2.ts lib/chat-files-v2.ts

# Restart app
```

## Need Help?

- **Full migration guide**: See `docs/FILE-MIGRATION.md`
- **API reference**: See `lib/file-manager/README.md`
- **Implementation details**: See `docs/FILE-SYSTEM-IMPLEMENTATION.md`

## Key Benefits

✅ **Single location** for all files
✅ **UUID-based naming** prevents conflicts
✅ **All under `data/`** directory
✅ **Automatic deduplication** by content hash
✅ **Relationship tracking** via `linkedTo` array
✅ **Better metadata** for every file
✅ **Won't lose files** after reboots
✅ **Easier backups** (one directory)

## File Entry Structure

```typescript
{
  id: "550e8400-e29b-41d4-a716-446655440000",
  sha256: "abc123...",
  originalFilename: "avatar.png",
  mimeType: "image/png",
  size: 54321,
  linkedTo: ["char-123", "chat-456"],  // <- Key feature!
  source: "UPLOADED",
  category: "AVATAR",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z"
}
```

## Next Steps

1. Run the dry-run migration
2. Review the output
3. Back up your data
4. Run the real migration
5. Update your code
6. Test everything
7. Deploy!
