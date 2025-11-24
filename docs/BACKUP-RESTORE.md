# Backup and Restore Guide

## Overview

Quilltap stores all application data in JSON files within the `data/` directory. This guide covers backing up and restoring your Quilltap data safely.

## Data Structure

The `data/` directory contains:

```
data/
├── characters/              # Character definitions
├── personas/               # User personas
├── chats/                 # Chat conversations and messages
├── auth/                  # Authentication data
│   ├── accounts.json       # OAuth account information
│   ├── sessions.jsonl      # Active sessions (append-only)
│   └── verification-tokens.jsonl  # Email verification tokens
├── tags/                  # Character and chat tags
├── image-profiles/        # Image profile configurations
├── settings/              # Application settings
│   ├── general.json
│   └── connection-profiles.json  # LLM connection configurations
└── binaries/              # Image files
    └── [user-id]/         # User-specific images
```

**Important Files:**
- `data/auth/sessions.jsonl` - Contains active session tokens
- `data/auth/accounts.json` - OAuth account mappings
- `ENCRYPTION_MASTER_PEPPER` in `.env` - Master encryption key

## Regular Backups

### Automated Daily Backups

For production environments, set up automated daily backups using cron:

```bash
# Create backup script: backup-quilltap.sh
#!/bin/bash
BACKUP_DIR="/backups/quilltap"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
tar -czf "$BACKUP_DIR/quilltap_$TIMESTAMP.tar.gz" \
  -C /path/to/quilltap data/ \
  --exclude=data/binaries/cache
# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "quilltap_*.tar.gz" -mtime +7 -delete
```

Add to crontab:

```bash
crontab -e
# Add line: 0 2 * * * /path/to/backup-quilltap.sh
```

### Manual Backups

**Local Development:**

```bash
# Backup data directory
cp -r data/ data-backup-$(date +%Y%m%d-%H%M%S)/

# Or create a compressed archive
tar -czf quilltap-backup-$(date +%Y%m%d).tar.gz data/
```

**Docker Environment:**

```bash
# Backup data from running container
docker-compose exec app tar -czf - data/ > quilltap-backup-$(date +%Y%m%d).tar.gz

# Or copy data directory directly
docker cp quilltap-app:/app/data ./quilltap-data-backup-$(date +%Y%m%d)/
```

**Using Docker Volumes:**

```bash
# If data is in a named volume
docker run --rm -v quilltap_data:/data -v $(pwd):/backup \
  alpine tar -czf /backup/quilltap-backup.tar.gz -C /data .

# List available volumes
docker volume ls | grep quilltap
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
# Local backup
cp -r data/ data-backup/

# Network backup (NAS/Network share)
cp -r data/ /mnt/nas/quilltap-backups/

# Cloud backup
aws s3 cp data-backup.tar.gz s3://my-backup-bucket/quilltap/
# Or use Backblaze, Google Cloud Storage, etc.
```

### Encryption & Security

**Protect your backups:**

```bash
# Encrypt backup with GPG
tar -czf - data/ | gpg --symmetric --cipher-algo AES256 -o quilltap-backup.tar.gz.gpg

# Encrypt with OpenSSL
tar -czf - data/ | openssl enc -aes-256-cbc -out quilltap-backup.tar.gz.enc

# Verify backup integrity
sha256sum quilltap-backup.tar.gz > quilltap-backup.tar.gz.sha256
```

## Restore Procedures

### From Local Backup

**Stop the application first:**

```bash
docker-compose down
# OR for local development
# Kill the npm dev process
```

**Restore the data:**

```bash
# Extract backup
tar -xzf quilltap-backup-20250120.tar.gz

# Or copy from backup directory
rm -rf data/
cp -r data-backup/ data/

# Fix permissions
chmod -R 755 data/
```

**Restart the application:**

```bash
docker-compose up -d
# OR
npm run dev
```

### From Docker Volume

```bash
# Stop container
docker-compose down

# Extract volume backup
docker run --rm -v quilltap_data:/data -v $(pwd):/backup \
  alpine tar -xzf /backup/quilltap-backup.tar.gz -C /data --strip-components=1

# Restart
docker-compose up -d
```

### From Encrypted Backup

```bash
# Decrypt and extract (GPG)
gpg -d quilltap-backup.tar.gz.gpg | tar -xz

# Decrypt and extract (OpenSSL)
openssl enc -d -aes-256-cbc -in quilltap-backup.tar.gz.enc | tar -xz
```

### From Cloud Storage

```bash
# Download from S3
aws s3 cp s3://my-backup-bucket/quilltap/quilltap-backup.tar.gz .

# Extract
tar -xzf quilltap-backup.tar.gz

# Or use cloud restore directly
docker-compose down
aws s3 cp s3://my-backup-bucket/quilltap/quilltap-backup.tar.gz - | tar -xz
```

## Verification

### Check Backup Integrity

```bash
# Verify archive is not corrupted
tar -tzf quilltap-backup.tar.gz | head

# Count files in backup
tar -tzf quilltap-backup.tar.gz | wc -l

# Verify checksum
sha256sum -c quilltap-backup.tar.gz.sha256
```

### Test Restore (Optional Environment)

Before restoring to production:

```bash
# Extract to temporary location
mkdir /tmp/quilltap-test
tar -xzf quilltap-backup.tar.gz -C /tmp/quilltap-test

# Verify file counts match original
du -sh /tmp/quilltap-test/data/
du -sh /path/to/quilltap/data/

# Check encryption can be read
find /tmp/quilltap-test/data -name "*.json" | head | xargs grep -l "ciphertext"
```

## Recovery Scenarios

### Lost Encryption Key

**Without `ENCRYPTION_MASTER_PEPPER`:**

All encrypted API keys and authentication tokens become unrecoverable. You will need to:

1. Restore from a backup made while you had the key
2. Set `ENCRYPTION_MASTER_PEPPER` to the original value
3. Users can log back in and re-add their API keys

**Prevention:**

```bash
# Backup encryption key separately
echo $ENCRYPTION_MASTER_PEPPER > /secure/location/encryption-pepper.txt
chmod 600 /secure/location/encryption-pepper.txt
```

### Corrupted Session Files

Sessions are stored in `data/auth/sessions.jsonl`. If corrupted:

```bash
# Backup corrupted file
cp data/auth/sessions.jsonl data/auth/sessions.jsonl.corrupted

# Create empty sessions file
echo "" > data/auth/sessions.jsonl

# Users will need to log back in
docker-compose restart app
```

### Partial Data Loss

If specific files are corrupted:

```bash
# Check for corrupted JSON
find data/ -name "*.json" -exec python3 -m json.tool {} \; 2>&1 | grep -B2 "Expecting"

# Restore just that directory from backup
tar -xzf quilltap-backup.tar.gz data/characters/ -C /tmp/restore/
cp -r /tmp/restore/data/characters/* data/characters/
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

# Verify archive
if tar -tzf "$BACKUP_FILE" > /dev/null 2>&1; then
  echo "✓ Archive integrity verified"
else
  echo "✗ Archive corrupted"
  exit 1
fi

# Count files
COUNT=$(tar -tzf "$BACKUP_FILE" | wc -l)
echo "Files in backup: $COUNT"

# Check for expected directories
for DIR in characters personas chats auth settings binaries; do
  if tar -tzf "$BACKUP_FILE" | grep -q "data/$DIR/"; then
    echo "✓ Directory present: $DIR"
  else
    echo "⚠ Directory missing: $DIR"
  fi
done

echo "Validation complete"
```

Usage:
```bash
bash backup-validate.sh quilltap-backup.tar.gz
```

### Alert on Missing Backups

```bash
#!/bin/bash
# check-backup-age.sh
BACKUP_DIR="/backups/quilltap"
MAX_AGE_DAYS=2

LATEST=$(ls -t "$BACKUP_DIR"/quilltap_*.tar.gz 2>/dev/null | head -1)

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
2. **Access Backup** (5 min): Retrieve latest backup from secure location
3. **Preparation** (10 min): Verify backup integrity, prepare restore location
4. **Restore** (5 min): Extract backup and verify permissions
5. **Verification** (5 min): Check application starts and data is correct

### Recovery Point Objective (RPO): 24 hours

- Daily automated backups at 2 AM
- Last backup ensures maximum 24-hour data loss
- Increase frequency to hourly for production critical systems

### Step-by-Step Recovery

1. **Verify you have the backup:**
   ```bash
   ls -lh /backups/quilltap/quilltap_*.tar.gz | tail -3
   ```

2. **Stop the application:**
   ```bash
   docker-compose down
   ```

3. **Backup current corrupted data (for forensics):**
   ```bash
   mv data/ data-corrupted-$(date +%s)/
   ```

4. **Extract backup:**
   ```bash
   tar -xzf /backups/quilltap/quilltap_LATEST.tar.gz
   ```

5. **Restore encryption key (if needed):**
   ```bash
   export ENCRYPTION_MASTER_PEPPER=$(cat /secure/location/encryption-pepper.txt)
   ```

6. **Start application:**
   ```bash
   docker-compose up -d
   ```

7. **Verify:**
   ```bash
   docker-compose logs -f app
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

# Delete backups older than 7 days
find "$BACKUP_DIR" -name "quilltap_*.tar.gz" -mtime +7 -delete

# Verify deletion
ls -lh "$BACKUP_DIR"
```

### Backup Auditing

```bash
# Log all backup operations
echo "$(date): Backup started" >> $BACKUP_DIR/backup.log
tar -czf "$BACKUP_FILE" data/ >> $BACKUP_DIR/backup.log 2>&1
echo "$(date): Backup completed. Size: $(du -h $BACKUP_FILE)" >> $BACKUP_DIR/backup.log
```

## Troubleshooting

### Backup is Too Large

```bash
# Exclude non-essential directories
tar --exclude='data/binaries/cache' -czf backup.tar.gz data/

# Or compress more aggressively
tar -czf --auto-compress backup.tar backup.tar data/
```

### Restore Takes Too Long

```bash
# For large backups, monitor progress
pv -i 0.5 quilltap-backup.tar.gz | tar -xz

# Or use parallel extraction
tar -xzf quilltap-backup.tar.gz --checkpoint=.100
```

### Verification Failures

```bash
# Check file permissions
ls -la data/auth/
chmod 755 data/auth/

# Verify JSON syntax
python3 -c "import json; json.load(open('data/settings/general.json'))"
```

## Further Reading

- [Data Management](../README.md#data-management)
- [Deployment Guide](DEPLOYMENT.md)
- [Phase 6: Cleanup & Documentation](../docs/PHASE-6-CLEANUP.md)
