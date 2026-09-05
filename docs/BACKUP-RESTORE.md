# Backup and Restore Guide

## Overview

Quilltap stores application data in **SQLite** and files on the **local filesystem**. This guide covers backing up and restoring your Quilltap data safely.

## Built-in Backup & Restore (Recommended)

Quilltap includes a built-in backup and restore system accessible from the **System** tab in **Settings** (`/settings?tab=system`).

### Using the UI

1. Navigate to **Tools** from the dashboard or sidebar
2. Click **Create Backup** to export your data as a downloadable ZIP file
3. Click **Restore from Backup** to import data from a previously downloaded ZIP file

### What's Included in Backups

The backup creates a ZIP file containing:

**Data (JSON files)**
- All characters and their metadata (including user-controlled characters)
- Character plugin data (per-character, per-plugin metadata such as Commonplace Book entries)
- Chat history, messages, and impersonation state
- Conversation annotations (per-message annotations added during roleplay)
- Tags
- Memories (including inter-character relationships)
- Connection profiles (API key references preserved, but keys require re-entry)
- Image profiles
- Embedding profiles
- Prompt templates (user-created)
- Roleplay templates (user-created)
- Projects and their configurations
- Character groups (slim rows plus the `group_character_members` and `group_doc_mount_links` join tables; the group's description/scenarios/knowledge ride along in the document-store tables)
- LLM request/response logs
- Plugin configurations (per-plugin settings)
- Provider model cache
- Chat settings (the per-user display/behaviour settings record)
- Instance settings (every `instance_settings` key/value row, including the
  mount-point ids that runtime routing depends on)
- Text replacement rules (the global find→replace list)
- Folder structure

**Document stores (the Scriptorium)**
- Mount points, their folder hierarchy, file and content rows, and hard links
- Database-backed document text, and binary blobs (staged as loose files under
  `mount-blobs/` rather than base64-inflated into JSON)
- Project ↔ store and group ↔ store associations
- This is where vault-first content travels: character fields, scenarios,
  knowledge, and **wardrobe items** are `Wardrobe/*.md` and `Scenarios/*.md`
  documents in a store, not rows of their own. (The `wardrobe_items` and
  `outfit_presets` tables were dropped in 4.7 and 4.5 respectively.)

**Document Mode**
- Per-chat Document Mode pane state

**Embeddings** (omitted wholesale in *compact* mode, which flags the archive so
a restore queues a full re-index)
- Memory embeddings, per-character vector indices and vector entries
- Conversation chunks and document-store chunks
- TF-IDF vocabularies and per-entity embedding sync flags

**Files**
- All uploaded files (images, documents, attachments)
- File metadata and folder organization

**Plugins**
- npm-installed plugins from the `plugins/npm/` directory
- Plugin configuration settings

**Themes**
- User-installed theme bundles (from `<data-dir>/themes/`)
- Bundled/built-in themes are not included (they ship with the app)

**Not included**
- API key values (encrypted with user-specific keys; must be re-entered after
  restore). This is the only category withheld for secrecy — everything else
  left out is either regenerable or meaningless on another instance.
- Previous backup files (to avoid recursion)
- Help documentation (`help_docs` and `help_doc_chunks`) — shipped with the
  app and rebuilt from disk at startup whenever a document's content hash
  changes, so restoring a copy would only pin stale text
- The background job queue and terminal sessions — transient runtime state
- `migrations_state` / `migrations_metadata` — the receiving instance keeps its
  own migration history

### API Endpoints

For automation or scripting, you can use the backup API directly:

```bash
# Create a backup (returns backupId for download)
curl -X POST https://your-quilltap/api/v1/system/backup \
  -H "Cookie: your-session-cookie"

# Download the backup (use the backupId from the previous response)
curl https://your-quilltap/api/v1/system/backup/{backupId} \
  -H "Cookie: your-session-cookie" \
  -o quilltap-backup.zip

# Preview a backup before restoring
curl -X POST "https://your-quilltap/api/v1/system/restore?action=preview" \
  -H "Cookie: your-session-cookie" \
  -F "file=@quilltap-backup.zip"

# Restore from backup
curl -X POST https://your-quilltap/api/v1/system/restore \
  -H "Cookie: your-session-cookie" \
  -F "file=@quilltap-backup.zip" \
  -F "mode=replace"
```

---

## Manual Backup Procedures

For server administrators who need direct database access or want additional backup strategies involving SQLite:

## Data Structure

Since Quilltap uses SQLite, all data is contained in a single database file. The database includes tables for:

- `users` - User accounts and authentication data
- `characters` - Character definitions and metadata (includes `controlledBy` for LLM/user control)
- `chats` - Chat metadata, message history, and impersonation state
- `files` - File metadata (actual files stored on local filesystem)
- `tags` - Tag definitions
- `memories` - Character memory data with inter-character relationships
- `connectionProfiles` - LLM connection configurations
- `embeddingProfiles` - Embedding provider configurations
- `imageProfiles` - Image generation configurations
- `llm_logs` - LLM request/response logs for debugging and monitoring

### File Storage

Files are stored on the local filesystem:

- `users/{userId}/files/` - User-uploaded files
- `users/{userId}/images/` - Generated and uploaded images

**Important:**

- `data/quilltap.dbkey` — the one `.dbkey` file, holding the encrypted database key (pepper). All three databases open with it; without it, none of them can be opened. Note the `data/` subdirectory: the key file sits alongside the `.db` files, not in the base directory. See [Database Encryption](DATABASE_ENCRYPTION.md) for details.
- SQLite database file path configuration
- File storage directory path

## Regular Backups

### Automated Daily Backups

For production environments, set up automated daily backups using cron:

```bash
#!/bin/bash
# Create backup script: backup-quilltap.sh
BACKUP_DIR="/backups/quilltap"
SQLITE_PATH="/app/quilltap/data/quilltap.db"
FILES_PATH="/app/quilltap/files"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup SQLite database
cp "$SQLITE_PATH" "$BACKUP_DIR/quilltap_$TIMESTAMP.db"
tar -czf "$BACKUP_DIR/quilltap_$TIMESTAMP.db.tar.gz" \
  -C "$BACKUP_DIR" "quilltap_$TIMESTAMP.db"
rm "$BACKUP_DIR/quilltap_$TIMESTAMP.db"

# Backup files (if using local storage)
tar -czf "$BACKUP_DIR/files_$TIMESTAMP.tar.gz" "$FILES_PATH"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "quilltap_*.db.tar.gz" -mtime +7 -delete
find "$BACKUP_DIR" -name "files_*.tar.gz" -mtime +7 -delete
```

Add to crontab:

```bash
crontab -e
# Add line: 0 2 * * * /path/to/backup-quilltap.sh
```

### Manual Backups

**SQLite Database Backup:**

```bash
# Simple copy of database file
cp /path/to/quilltap.db /backup/quilltap-$(date +%Y%m%d).db

# Or create a compressed archive
tar -czf quilltap-$(date +%Y%m%d).db.tar.gz /path/to/quilltap.db

# While the application is running (recommended):
# SQLite can be safely backed up while in use due to WAL mode
cp /path/to/quilltap.db /backup/quilltap-$(date +%Y%m%d).db
```

**Local Files Backup:**

```bash
# Backup local file storage
tar -czf quilltap-files-$(date +%Y%m%d).tar.gz /path/to/quilltap/files/
```

**Docker Environment:**

```bash
# Backup SQLite database from Docker volume
docker cp quilltap-app:/app/quilltap/data/quilltap.db ./quilltap-$(date +%Y%m%d).db

# Or backup the entire data directory
docker cp quilltap-app:/app/quilltap/data ./quilltap-data-backup-$(date +%Y%m%d)/
```

## Backup Best Practices

### Before Major Operations

Always backup before:

- Upgrading to a new version
- Making configuration changes
- Running production deployments
- Modifying encryption settings

### Backup Location

Store backups in multiple locations:

```bash
# Local SQLite backup
cp /path/to/quilltap.db ./quilltap-backup-$(date +%Y%m%d).db

# Network backup (NAS/Network share)
cp quilltap-backup-*.db /mnt/nas/quilltap-backups/

# Cloud backup for SQLite database (if using remote backup)
# aws s3 cp quilltap-backup-*.db s3://my-backup-bucket/quilltap/
```

### Encryption & Security

Quilltap databases are encrypted at rest with SQLCipher. Physical backup files (`.db`) are already encrypted — they cannot be opened without the pepper stored in the `.dbkey` files. For additional protection or for logical backup ZIP files:

```bash
# Encrypt a logical backup ZIP with GPG
gpg --symmetric --cipher-algo AES256 -o quilltap-backup.zip.gpg quilltap-backup.zip

# Encrypt with OpenSSL
openssl enc -aes-256-cbc -in quilltap-backup.zip -out quilltap-backup.zip.enc

# Verify backup integrity
sha256sum quilltap-backup.zip > quilltap-backup.zip.sha256
```

**Important:** Always back up `data/quilltap.dbkey` alongside your database files. Without it (or the passphrase used to protect it), physical database backups are unrecoverable.

## Restore Procedures

### From SQLite Backup

**Stop the application first:**

```bash
docker stop quilltap
# OR for local development
# Kill the npm dev process
```

**Restore SQLite database:**

```bash
# From uncompressed backup
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db

# From compressed archive
tar -xzf quilltap-backup-YYYYMMDD.db.tar.gz -C /path/to/
cp quilltap.db /path/to/quilltap.db
```

**Restore files:**

```bash
# Restore local files
tar -xzf quilltap-files-YYYYMMDD.tar.gz -C /
```

**Restart the application:**

```bash
docker start quilltap
# OR
npm run dev
```

### From Docker Container Backup

```bash
# Stop container
docker stop quilltap

# Restore SQLite database file
docker cp ./quilltap-backup-YYYYMMDD.db quilltap:/app/quilltap/data/quilltap.db

# Restart
docker start quilltap
```

### From Encrypted Backup

```bash
# Decrypt (GPG)
gpg -d quilltap-backup-YYYYMMDD.db.gpg > quilltap-backup-YYYYMMDD.db

# Decrypt (OpenSSL)
openssl enc -d -aes-256-cbc -in quilltap-backup-YYYYMMDD.db.enc -out quilltap-backup-YYYYMMDD.db

# Then restore as normal
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db
```

### From Cloud Storage

```bash
# Download SQLite backup from cloud storage (if using cloud backups)
# aws s3 cp s3://my-backup-bucket/quilltap/quilltap-backup-YYYYMMDD.db .

# Restore SQLite database
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db
```

## Verification

### Check Backup Integrity

Since databases are encrypted with SQLCipher, the standard `sqlite3` CLI cannot open them. Use the Quilltap CLI instead:

```bash
# Verify database file is valid (requires .dbkey file in the data directory)
npx quilltap db "SELECT COUNT(*) FROM users;"

# For a specific data directory
npx quilltap db --data-dir /path/to/backup-data "SELECT COUNT(*) FROM users;"

# If the .dbkey is passphrase-protected
npx quilltap db --passphrase <pass> "SELECT COUNT(*) FROM users;"

# For compressed backups, verify archive integrity first
tar -tzf quilltap-backup-YYYYMMDD.db.tar.gz | head

# Verify checksum
sha256sum -c quilltap-backup-YYYYMMDD.db.sha256
```

### Test Restore (Optional Environment)

Before restoring to production, test with a separate data directory. Both the `.dbkey` file and the database file must be present, and both live under `data/`:

```bash
# Create a test directory with copies of the backup
mkdir -p /tmp/quilltap-test/data
cp quilltap-backup-YYYYMMDD.db /tmp/quilltap-test/data/quilltap.db
cp quilltap.dbkey /tmp/quilltap-test/data/quilltap.dbkey

# Verify data
npx quilltap db --data-dir /tmp/quilltap-test "SELECT COUNT(*) FROM users;"
npx quilltap db --data-dir /tmp/quilltap-test "SELECT COUNT(*) FROM characters;"

# Clean up
rm -rf /tmp/quilltap-test
```

## Recovery Scenarios

### Lost Encryption Key

**Without the `.dbkey` file:**

If the `.dbkey` file is lost or corrupted and you don't have a backup of it, the encrypted database files cannot be opened. You will need to:

1. Restore the `.dbkey` file from a backup, OR
2. Restore both the `.dbkey` file and database files from a backup made at the same time
3. Re-add API keys and other configuration as needed

**Prevention:**

```bash
# Back up the .dbkey file alongside your database.
# Note the data/ subdirectory — the key file lives beside the .db files.
cp ~/Library/Application\ Support/Quilltap/data/quilltap.dbkey /secure/location/
chmod 600 /secure/location/quilltap.dbkey
```

There is one `.dbkey` file per instance, and every database opens with it. If you find a `quilltap-llm-logs.dbkey` beside it, that is a leftover from before 4.8.1 — nothing reads it, and it may hold an out-of-date copy of the key, so do not treat it as a spare. Back up `quilltap.dbkey`.

If you set a custom passphrase on the `.dbkey` file, you must also remember the passphrase. See [Database Encryption](DATABASE_ENCRYPTION.md) for details.

### Corrupted SQLite Database

If SQLite database is corrupted:

```bash
# Check database integrity (uses the Quilltap CLI since databases are encrypted)
npx quilltap db "PRAGMA integrity_check;"

# If corrupted, restore from backup (include the .dbkey file if restoring to a fresh location)
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db

# Restart the application
docker restart quilltap
```

### Lost Files

If files are lost but metadata exists in the SQLite database:

```bash
# The application handles missing files gracefully
# Users can re-upload avatars and files as needed

# Or restore from file backup
tar -xzf quilltap-files-YYYYMMDD.tar.gz -C /
```

## Monitoring Backups

### Backup Validation Script

```bash
#!/bin/bash
# backup-validate.sh
BACKUP_FILE="$1"

echo "Validating backup: $BACKUP_FILE"

# Check file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found"
  exit 1
fi

# Check file size
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup size: $SIZE"

# Verify gzip integrity
if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "✓ Archive integrity verified"
else
  echo "✗ Archive corrupted"
  exit 1
fi

echo "Validation complete"
```

Usage:

```bash
bash backup-validate.sh quilltap-20250120_120000.db.tar.gz
```

### Alert on Missing Backups

```bash
#!/bin/bash
# check-backup-age.sh
BACKUP_DIR="/backups/quilltap"
MAX_AGE_DAYS=2

LATEST=$(ls -t "$BACKUP_DIR"/quilltap_*.db.tar.gz 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "ERROR: No backups found in $BACKUP_DIR"
  # Send alert (email, webhook, etc.)
  exit 1
fi

MODIFIED=$(stat -f %m "$LATEST" 2>/dev/null || stat -c %Y "$LATEST")
NOW=$(date +%s)
AGE=$((($NOW - $MODIFIED) / 86400))

if [ $AGE -gt $MAX_AGE_DAYS ]; then
  echo "WARNING: Latest backup is $AGE days old"
  # Send alert
  exit 1
fi

echo "Latest backup is current: $AGE days old"
```

## Disaster Recovery Plan

### Recovery Time Objective (RTO): 30 minutes

1. **Detection** (5 min): Monitor alerts, confirm data loss
2. **Access Backup** (5 min): Retrieve latest SQLite and file backups from secure location
3. **Preparation** (10 min): Verify backup integrity, prepare SQLite and files
4. **Restore** (5 min): Restore SQLite and file data
5. **Verification** (5 min): Check application starts and data is correct

### Recovery Point Objective (RPO): 24 hours

- Daily automated backups at 2 AM
- Last backup ensures maximum 24-hour data loss
- Increase frequency to hourly for production critical systems

### Step-by-Step Recovery

1. **Verify you have the backup:**

   ```bash
   ls -lh /backups/quilltap/quilltap_*.db.tar.gz | tail -3
   ```

2. **Stop the application:**

   ```bash
   docker stop quilltap
   ```

3. **Restore the `.dbkey` file (if needed):**

   ```bash
   cp /secure/location/quilltap.dbkey /app/quilltap/data/quilltap.dbkey
   chmod 600 /app/quilltap/data/quilltap.dbkey
   ```

4. **Restore SQLite database:**

   ```bash
   cp /backups/quilltap/quilltap_LATEST.db /app/quilltap/data/quilltap.db
   ```

5. **Restore files (if backed up separately):**

   ```bash
   tar -xzf /backups/quilltap/files_LATEST.tar.gz -C /
   ```

6. **Start application:**

   ```bash
   docker start quilltap
   ```

7. **Verify:**

   ```bash
   docker logs -f quilltap
   curl http://localhost:3000/api/health
   ```

## Compliance & Retention

### Data Retention Policy

- **Active backups**: Keep 7 days of daily backups
- **Archive backups**: Keep 4 weekly backups
- **Historical**: Keep 1 backup per month for 1 year

```bash
# Implement retention policy
BACKUP_DIR="/backups/quilltap"

# Delete SQLite backups older than 7 days
find "$BACKUP_DIR" -name "quilltap_*.db.tar.gz" -mtime +7 -delete

# Verify deletion
ls -lh "$BACKUP_DIR"
```

### Backup Auditing

```bash
# Log all backup operations
echo "$(date): Backup started" >> $BACKUP_DIR/backup.log
cp "$SQLITE_PATH" "$BACKUP_FILE" >> $BACKUP_DIR/backup.log 2>&1
echo "$(date): Backup completed. Size: $(du -h $BACKUP_FILE)" >> $BACKUP_DIR/backup.log
```

## Troubleshooting

### Backup is Too Large

SQLite backups are typically smaller than MongoDB backups due to the single-file format. If backups are large:

```bash
# Use compression (recommended)
tar -czf quilltap-backup-$(date +%Y%m%d).db.tar.gz /path/to/quilltap.db

# Monitor backup file size
du -h quilltap-backup-*.db*
```

### Restore Takes Too Long

SQLite restore is typically fast since it's a file copy operation:

```bash
# Monitor restore progress
ls -lh /path/to/quilltap.db

# Check application startup logs
docker logs -f quilltap
```

### Logical Restore Completed but Stores or Files Are Missing

Fixed in 4.8. Restores performed on earlier builds could report success while
silently dropping every document store, every store file link, and every user
file — most visibly when restoring into a fresh or freshly-wiped instance. The
archives themselves are correct: re-run the restore on 4.8 or later and the
same archive comes back whole.

To confirm a restore landed:

```bash
# Stores and links live in the mount-index database
npx quilltap db --mount-points "SELECT COUNT(*) FROM doc_mount_points;"
npx quilltap db --mount-points "SELECT COUNT(*) FROM doc_mount_file_links;"

# User file rows in the main database
npx quilltap db "SELECT COUNT(*) FROM files;"
```

A restored archive that held document stores must come back with non-zero
counts in all three. Zeros in the first two are the signature of the
pre-4.8 defect.

### Verification Failures

```bash
# Check SQLite database validity (requires .dbkey file)
npx quilltap db "PRAGMA integrity_check;"

# Verify table counts
npx quilltap db "SELECT COUNT(*) FROM users;"
npx quilltap db "SELECT COUNT(*) FROM characters;"

# Check file storage connectivity
ls -la /path/to/quilltap/files/
```

## Further Reading

- [Data Management](../README.md#data-management)
- [Deployment Guide](DEPLOYMENT.md)
