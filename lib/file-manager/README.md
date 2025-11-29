# Centralized File Manager

The centralized file manager provides a single source of truth for all file operations in Quilltap.

## Architecture

### Storage

All files are stored in:
```
data/files/storage/{uuid}.{ext}
```

Each file is named using its UUID identifier, with the original extension preserved.

### Metadata Database

File metadata is tracked in:
```
data/files/files.jsonl
```

This is a JSON Lines file where each line contains a complete `FileEntry` object.

## File Entry Structure

```typescript
interface FileEntry {
  // Identity & Storage
  id: string;                    // UUID - also the filename
  sha256: string;                // Content hash (64 chars)
  originalFilename: string;      // Original upload name
  mimeType: string;              // MIME type
  size: number;                  // Bytes

  // Image metadata (optional)
  width?: number;
  height?: number;

  // Relationships
  linkedTo: string[];            // Array of entity IDs

  // Classification
  source: FileSource;            // UPLOADED | GENERATED | IMPORTED | SYSTEM
  category: FileCategory;        // IMAGE | DOCUMENT | AVATAR | ATTACHMENT | EXPORT

  // Generation metadata (for AI files)
  generationPrompt?: string;
  generationModel?: string;
  generationRevisedPrompt?: string;
  description?: string;

  // Tags
  tags: string[];                // Tag UUIDs

  // Timestamps
  createdAt: string;             // ISO-8601
  updatedAt: string;             // ISO-8601
}
```

## Usage

### Creating Files

```typescript
import { createFile } from '@/lib/file-manager';

const fileEntry = await createFile({
  buffer: fileBuffer,
  originalFilename: 'avatar.png',
  mimeType: 'image/png',
  source: 'UPLOADED',
  category: 'AVATAR',
  linkedTo: [characterId],
  tags: [tagId],
  width: 512,
  height: 512,
});
```

### Finding Files

```typescript
import {
  findFileById,
  findFileByHash,
  findFilesLinkedTo,
  findFilesByCategory,
  findFilesBySource,
  findFilesByTag,
  getAllFiles,
} from '@/lib/file-manager';

// By ID
const file = await findFileById('550e8400-e29b-41d4-a716-446655440000');

// By content hash (for deduplication)
const existing = await findFileByHash(sha256Hash);

// All files linked to an entity
const chatFiles = await findFilesLinkedTo(chatId);

// By category
const images = await findFilesByCategory('IMAGE');

// By source
const generated = await findFilesBySource('GENERATED');

// By tag
const tagged = await findFilesByTag(tagId);

// All files
const all = await getAllFiles();
```

### Reading Files

```typescript
import { readFile, readFileAsBase64 } from '@/lib/file-manager';

// As Buffer
const buffer = await readFile(fileId);

// As Base64 (for LLM APIs)
const base64 = await readFileAsBase64(fileId);
```

### Updating Metadata

```typescript
import { updateFile, addFileLink, removeFileLink, addFileTag, removeFileTag } from '@/lib/file-manager';

// Update any field
const updated = await updateFile(fileId, {
  description: 'Updated description',
});

// Add a link to an entity
await addFileLink(fileId, messageId);

// Remove a link
await removeFileLink(fileId, messageId);

// Add a tag
await addFileTag(fileId, tagId);

// Remove a tag
await removeFileTag(fileId, tagId);
```

### Deleting Files

```typescript
import { deleteFile } from '@/lib/file-manager';

// Deletes both the file and its metadata
const deleted = await deleteFile(fileId);
```

**Note**: Files should only be deleted when they have no remaining links. Always check `linkedTo` before deletion.

### Getting File URLs

```typescript
import { getFileUrl, getFileSystemPath } from '@/lib/file-manager';

// Public URL (for API responses)
const url = getFileUrl(fileId, originalFilename);
// Returns: /data/files/storage/{uuid}.{ext}

// Filesystem path (for server-side operations)
const path = getFileSystemPath(fileId, originalFilename);
// Returns: /path/to/project/data/files/storage/{uuid}.{ext}
```

### File Statistics

```typescript
import { getFileStats } from '@/lib/file-manager';

const stats = await getFileStats();
// Returns:
// {
//   totalFiles: 156,
//   totalSize: 45678901,
//   byCategory: { IMAGE: 125, ATTACHMENT: 27, ... },
//   bySource: { UPLOADED: 98, GENERATED: 47, ... }
// }
```

## Deduplication

The file manager automatically handles deduplication:

```typescript
// First upload
const file1 = await createFile({
  buffer: imageBuffer,
  originalFilename: 'photo.jpg',
  mimeType: 'image/jpeg',
  source: 'UPLOADED',
  category: 'IMAGE',
  linkedTo: [chatId1],
});

// Second upload of the same file
const file2 = await createFile({
  buffer: imageBuffer,  // Same content
  originalFilename: 'photo-copy.jpg',
  mimeType: 'image/jpeg',
  source: 'UPLOADED',
  category: 'IMAGE',
  linkedTo: [chatId2],
});

// file1.id === file2.id (same file entry)
// file1.linkedTo === [chatId1, chatId2] (merged links)
// Only one physical file stored
```

## Integration with JSON Store

The file manager integrates with the JSON Store via the `FilesRepository`:

```typescript
import { getJsonStore } from '@/lib/json-store';
import { FilesRepository } from '@/lib/json-store/repositories/files.repository';

const jsonStore = getJsonStore();
const filesRepo = new FilesRepository(jsonStore);

// Use repository methods
const file = await filesRepo.findById(fileId);
const images = await filesRepo.findByCategory('IMAGE');
```

## File Categories

### IMAGE
- Gallery images
- Character/persona avatars
- Uploaded/imported/generated images
- Typically displayed in UI

### DOCUMENT
- PDF files
- Text files
- Markdown files
- CSV files
- Usually attached to messages

### AVATAR
- Dedicated avatar images
- May be treated specially in UI
- Can be character or persona avatars

### ATTACHMENT
- General file attachments
- Chat message files
- Mixed content types

### EXPORT
- Exported data files
- Character/persona exports
- Chat exports
- System-generated files

## File Sources

### UPLOADED
- User uploaded via file picker
- Direct file uploads

### GENERATED
- AI-generated images (DALL-E, etc.)
- Includes generation metadata

### IMPORTED
- Fetched from URLs
- Imported from external sources
- Character PNG imports

### SYSTEM
- System-created files
- Default assets
- Internal use files

## Linked Entities

The `linkedTo` array connects files to:

- **Messages**: Files attached to chat messages
- **Chats**: Files associated with a conversation
- **Characters**: Character avatars and images
- **Personas**: Persona avatars and images
- **Tags**: Files can also use the `tags` array

This enables:
- Finding all files in a chat
- Getting a character's images
- Tracking message attachments
- Managing relationships

## Error Handling

```typescript
import { findFileById, deleteFile } from '@/lib/file-manager';

try {
  const file = await findFileById(fileId);
  if (!file) {
    console.error('File not found');
    return;
  }

  await deleteFile(fileId);
} catch (error) {
  console.error('File operation failed:', error);
}
```

Common errors:
- File not found (returns `null` or `false`)
- Permission denied (throws error)
- Disk full (throws error)
- Invalid data (throws validation error)

## Best Practices

### 1. Always link files to entities

```typescript
// Good
await createFile({
  buffer,
  originalFilename: 'image.png',
  mimeType: 'image/png',
  source: 'UPLOADED',
  category: 'IMAGE',
  linkedTo: [characterId, chatId],  // ✓
});

// Bad
await createFile({
  buffer,
  originalFilename: 'image.png',
  mimeType: 'image/png',
  source: 'UPLOADED',
  category: 'IMAGE',
  linkedTo: [],  // ✗ No links
});
```

### 2. Check links before deletion

```typescript
// Good
const file = await findFileById(fileId);
if (file && file.linkedTo.length === 0) {
  await deleteFile(fileId);
}

// Bad
await deleteFile(fileId);  // ✗ Might be in use
```

### 3. Use appropriate categories

```typescript
// Good
await createFile({
  category: file.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
  // ...
});

// Bad
await createFile({
  category: 'IMAGE',  // ✗ Even for PDFs
  // ...
});
```

### 4. Preserve original filenames

```typescript
// Good
originalFilename: file.name,  // ✓ "My Vacation Photo.jpg"

// Bad
originalFilename: `${userId}_${Date.now()}.jpg`,  // ✗ Lost context
```

### 5. Include descriptions for generated files

```typescript
// Good
await createFile({
  source: 'GENERATED',
  generationPrompt: 'A portrait of {{char}}',
  description: 'Generated portrait of character in medieval style',
  // ...
});
```

## Performance Considerations

### JSONL File Size

- Each file entry is ~500-1000 bytes
- 10,000 files ≈ 5-10 MB JSONL file
- Reads are cached by Node.js
- Updates rewrite the entire file

### Deduplication

- SHA256 calculation is CPU intensive
- Done once per upload
- Subsequent lookups are fast

### Recommendations

- For >100K files, consider a database
- For <10K files, JSONL is performant
- Use `findByCategory` instead of `getAllFiles` when possible

## Migration

See [FILE-MIGRATION.md](../../docs/FILE-MIGRATION.md) for detailed migration instructions.

## Testing

```typescript
import { createFile, findFileById, deleteFile } from '@/lib/file-manager';

describe('File Manager', () => {
  it('should create and retrieve a file', async () => {
    const buffer = Buffer.from('test content');

    const file = await createFile({
      buffer,
      originalFilename: 'test.txt',
      mimeType: 'text/plain',
      source: 'UPLOADED',
      category: 'DOCUMENT',
      linkedTo: ['test-entity'],
    });

    expect(file.id).toBeDefined();
    expect(file.sha256).toBeDefined();

    const retrieved = await findFileById(file.id);
    expect(retrieved).toEqual(file);

    await deleteFile(file.id);
  });
});
```
