# Backup and Restore Guide

## Overview

Quilltap stores application data in **MongoDB** and files in **S3-compatible storage**. This guide covers backing up and restoring your Quilltap data safely.

## Data Structure

### MongoDB Collections

- `users` - User accounts and authentication data
- `characters` - Character definitions and metadata
- `personas` - User persona definitions
- `chats` - Chat metadata and message history
- `files` - File metadata (actual files stored in S3)
- `tags` - Tag definitions
- `memories` - Character memory data
- `connectionProfiles` - LLM connection configurations
- `embeddingProfiles` - Embedding provider configurations
- `imageProfiles` - Image generation configurations

### S3 Storage

Files are stored in S3-compatible storage:

- `users/{userId}/files/` - User-uploaded files
- `users/{userId}/images/` - Generated and uploaded images

**Important:**

- `ENCRYPTION_MASTER_PEPPER` in `.env` - Master encryption key (required to decrypt API keys)
- MongoDB connection string and credentials
- S3 credentials and bucket configuration

## Regular Backups

### Automated Daily Backups

For production environments, set up automated daily backups using cron:

```bash
#!/bin/bash
# Create backup script: backup-quilltap.sh
BACKUP_DIR="/backups/quilltap"
MONGODB_URI="mongodb://localhost:27017/quilltap"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup MongoDB
mongodump --uri="$MONGODB_URI" --out="$BACKUP_DIR/mongo_$TIMESTAMP"
tar -czf "$BACKUP_DIR/quilltap_mongo_$TIMESTAMP.tar.gz" \
  -C "$BACKUP_DIR" "mongo_$TIMESTAMP"
rm -rf "$BACKUP_DIR/mongo_$TIMESTAMP"

# Backup S3 files (using MinIO client)
# mc mirror myminio/quilltap-files "$BACKUP_DIR/s3_$TIMESTAMP"
# tar -czf "$BACKUP_DIR/quilltap_s3_$TIMESTAMP.tar.gz" \
#   -C "$BACKUP_DIR" "s3_$TIMESTAMP"
# rm -rf "$BACKUP_DIR/s3_$TIMESTAMP"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "quilltap_*.tar.gz" -mtime +7 -delete
```

Add to crontab:

```bash
crontab -e
# Add line: 0 2 * * * /path/to/backup-quilltap.sh
```

### Manual Backups

**MongoDB Backup:**

```bash
# Backup MongoDB database
mongodump --uri="mongodb://localhost:27017/quilltap" --out=backup-$(date +%Y%m%d)

# Or create a compressed archive
mongodump --uri="mongodb://localhost:27017/quilltap" --archive=quilltap-$(date +%Y%m%d).gz --gzip
```

**S3/MinIO Backup:**

```bash
# Using MinIO client
mc mirror myminio/quilltap-files ./s3-backup-$(date +%Y%m%d)/

# Using AWS CLI
aws s3 sync s3://quilltap-files ./s3-backup-$(date +%Y%m%d)/ --endpoint-url http://localhost:9000
```

**Docker Environment:**

```bash
# Backup MongoDB from Docker container
docker exec quilltap-mongo mongodump --out=/backup
docker cp quilltap-mongo:/backup ./mongo-backup-$(date +%Y%m%d)/

# For MinIO, use mc or aws cli as shown above
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
# Local MongoDB backup
mongodump --uri="mongodb://localhost:27017/quilltap" --archive=quilltap-mongo.gz --gzip

# Network backup (NAS/Network share)
cp quilltap-mongo.gz /mnt/nas/quilltap-backups/

# Cloud backup for MongoDB dump
aws s3 cp quilltap-mongo.gz s3://my-backup-bucket/quilltap/

# For S3 files, sync to another bucket
aws s3 sync s3://quilltap-files s3://my-backup-bucket/quilltap-files/
```

### Encryption & Security

**Protect your backups:**

```bash
# Encrypt MongoDB backup with GPG
gpg --symmetric --cipher-algo AES256 -o quilltap-mongo.gz.gpg quilltap-mongo.gz

# Encrypt with OpenSSL
openssl enc -aes-256-cbc -in quilltap-mongo.gz -out quilltap-mongo.gz.enc

# Verify backup integrity
sha256sum quilltap-mongo.gz > quilltap-mongo.gz.sha256
```

## Restore Procedures

### From MongoDB Backup

**Stop the application first:**

```bash
docker-compose down
# OR for local development
# Kill the npm dev process
```

**Restore MongoDB:**

```bash
# From directory backup
mongorestore --uri="mongodb://localhost:27017/quilltap" --drop backup-YYYYMMDD/quilltap

# From compressed archive
mongorestore --uri="mongodb://localhost:27017/quilltap" --archive=quilltap-mongo.gz --gzip --drop
```

**Restore S3 files:**

```bash
# Using MinIO client
mc mirror ./s3-backup-YYYYMMDD/ myminio/quilltap-files

# Using AWS CLI
aws s3 sync ./s3-backup-YYYYMMDD/ s3://quilltap-files/ --endpoint-url http://localhost:9000
```

**Restart the application:**

```bash
docker-compose up -d
# OR
npm run dev
```

### From Docker Container Backup

```bash
# Stop container
docker-compose down

# Restore MongoDB
docker cp ./mongo-backup-YYYYMMDD/ quilltap-mongo:/backup
docker exec quilltap-mongo mongorestore --drop /backup

# Restart
docker-compose up -d
```

### From Encrypted Backup

```bash
# Decrypt (GPG)
gpg -d quilltap-mongo.gz.gpg > quilltap-mongo.gz

# Decrypt (OpenSSL)
openssl enc -d -aes-256-cbc -in quilltap-mongo.gz.enc -out quilltap-mongo.gz

# Then restore
mongorestore --uri="mongodb://localhost:27017/quilltap" --archive=quilltap-mongo.gz --gzip --drop
```

### From Cloud Storage

```bash
# Download MongoDB backup from S3
aws s3 cp s3://my-backup-bucket/quilltap/quilltap-mongo.gz .

# Restore MongoDB
mongorestore --uri="mongodb://localhost:27017/quilltap" --archive=quilltap-mongo.gz --gzip --drop

# Sync S3 files back
aws s3 sync s3://my-backup-bucket/quilltap-files/ s3://quilltap-files/
```

## Verification

### Check Backup Integrity

```bash
# Verify MongoDB archive is not corrupted
tar -tzf quilltap-mongo.tar.gz | head

# For gzipped mongodump
gunzip -t quilltap-mongo.gz

# Verify checksum
sha256sum -c quilltap-mongo.gz.sha256
```

### Test Restore (Optional Environment)

Before restoring to production, test on a separate MongoDB instance:

```bash
# Start a test MongoDB container
docker run -d --name mongo-test -p 27018:27017 mongo:7

# Restore to test instance
mongorestore --uri="mongodb://localhost:27018/quilltap-test" --archive=quilltap-mongo.gz --gzip

# Verify data
mongosh "mongodb://localhost:27018/quilltap-test" --eval "db.users.countDocuments()"
mongosh "mongodb://localhost:27018/quilltap-test" --eval "db.characters.countDocuments()"

# Clean up
docker stop mongo-test && docker rm mongo-test
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

### Corrupted MongoDB Data

If MongoDB data is corrupted:

```bash
# Check MongoDB status
mongosh quilltap --eval "db.runCommand('validate')"

# If corrupted, restore from backup
mongorestore --uri="mongodb://localhost:27017/quilltap" --archive=quilltap-mongo.gz --gzip --drop

# Users will need to log back in
docker-compose restart app
```

### Partial Data Loss

If specific collections are corrupted:

```bash
# Check collection integrity
mongosh quilltap --eval "db.characters.validate()"

# Restore just that collection from backup (requires directory backup)
mongorestore --uri="mongodb://localhost:27017/quilltap" \
  --nsInclude="quilltap.characters" --drop backup-YYYYMMDD/quilltap
```

### Lost S3 Files

If S3 files are lost but metadata exists in MongoDB:

```bash
# The application handles missing files gracefully
# Users can re-upload avatars and files as needed

# Or restore from S3 backup
aws s3 sync s3://my-backup-bucket/quilltap-files/ s3://quilltap-files/
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
bash backup-validate.sh quilltap-mongo.gz
```

### Alert on Missing Backups

```bash
#!/bin/bash
# check-backup-age.sh
BACKUP_DIR="/backups/quilltap"
MAX_AGE_DAYS=2

LATEST=$(ls -t "$BACKUP_DIR"/quilltap_mongo_*.gz 2>/dev/null | head -1)

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
2. **Access Backup** (5 min): Retrieve latest MongoDB and S3 backups from secure location
3. **Preparation** (10 min): Verify backup integrity, prepare MongoDB and S3
4. **Restore** (5 min): Restore MongoDB and S3 data
5. **Verification** (5 min): Check application starts and data is correct

### Recovery Point Objective (RPO): 24 hours

- Daily automated backups at 2 AM
- Last backup ensures maximum 24-hour data loss
- Increase frequency to hourly for production critical systems

### Step-by-Step Recovery

1. **Verify you have the backup:**

   ```bash
   ls -lh /backups/quilltap/quilltap_mongo_*.gz | tail -3
   ```

2. **Stop the application:**

   ```bash
   docker-compose down
   ```

3. **Restore encryption key (if needed):**

   ```bash
   export ENCRYPTION_MASTER_PEPPER=$(cat /secure/location/encryption-pepper.txt)
   ```

4. **Restore MongoDB:**

   ```bash
   mongorestore --uri="mongodb://localhost:27017/quilltap" \
     --archive=/backups/quilltap/quilltap_mongo_LATEST.gz --gzip --drop
   ```

5. **Restore S3 files (if backed up):**

   ```bash
   aws s3 sync /backups/quilltap/s3_LATEST/ s3://quilltap-files/
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

# Delete MongoDB backups older than 7 days
find "$BACKUP_DIR" -name "quilltap_mongo_*.gz" -mtime +7 -delete

# Verify deletion
ls -lh "$BACKUP_DIR"
```

### Backup Auditing

```bash
# Log all backup operations
echo "$(date): Backup started" >> $BACKUP_DIR/backup.log
mongodump --uri="$MONGODB_URI" --archive="$BACKUP_FILE" --gzip >> $BACKUP_DIR/backup.log 2>&1
echo "$(date): Backup completed. Size: $(du -h $BACKUP_FILE)" >> $BACKUP_DIR/backup.log
```

## Troubleshooting

### Backup is Too Large

```bash
# Exclude specific collections from backup
mongodump --uri="$MONGODB_URI" --excludeCollection=logs --archive=backup.gz --gzip

# Use compression
mongodump --uri="$MONGODB_URI" --archive=backup.gz --gzip
```

### Restore Takes Too Long

```bash
# For large backups, use multiple collections in parallel
mongorestore --uri="$MONGODB_URI" --numParallelCollections=4 --archive=backup.gz --gzip

# Monitor restore progress
mongosh quilltap --eval "db.currentOp()"
```

### Verification Failures

```bash
# Check MongoDB connection
mongosh quilltap --eval "db.runCommand('ping')"

# Verify collection counts
mongosh quilltap --eval "db.getCollectionNames().forEach(c => print(c + ': ' + db[c].countDocuments()))"

# Check S3 connectivity
aws s3 ls s3://quilltap-files/ --endpoint-url http://localhost:9000
```

## Further Reading

- [Data Management](../README.md#data-management)
- [Deployment Guide](DEPLOYMENT.md)
