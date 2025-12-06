# Quilltap Production Deployment Guide

## Overview

Quilltap requires **MongoDB** for data storage and **S3-compatible storage** for files. For development, you can use Docker Compose with embedded MongoDB and MinIO services. For production, you can use MongoDB Atlas and AWS S3, or self-host both services.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [Quick Start](#quick-start)
- [SSL Configuration](#ssl-configuration)
- [Environment Variables](#environment-variables)
- [Data Management](#data-management)
- [Monitoring](#monitoring)
- [Backup Strategy](#backup-strategy)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Server Requirements

- **Operating System**: Ubuntu 20.04+ or Debian 11+ (recommended)
- **RAM**: Minimum 2GB, recommended 4GB+ (MongoDB requires additional memory)
- **Storage**: Minimum 20GB SSD (MongoDB data can grow significantly)
- **CPU**: 2+ cores recommended
- **Network**: Public IP address with ports 80 and 443 accessible

### Domain Requirements

- Domain name pointing to your server's IP address
- DNS A record configured (allow 24-48 hours for propagation)

### Database & Storage Requirements

For self-hosted deployments:

- MongoDB 7+ running locally or in Docker
- MinIO or compatible S3 service

For cloud/production deployments:

- MongoDB Atlas (free tier available)
- AWS S3, Google Cloud Storage, or other S3-compatible service

### Required Software

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (logout/login after)
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify installations
docker --version
docker compose version
```

## Server Setup

### 1. Create Application User

```bash
# Create dedicated user for Quilltap
sudo adduser --disabled-password --gecos "" quilltap
sudo usermod -aG docker quilltap

# Switch to quilltap user
sudo su - quilltap
```

### 2. Clone Repository

```bash
cd ~
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
```

### 3. Configure Firewall

```bash
# Exit quilltap user temporarily
exit

# Configure UFW firewall
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable

# Verify rules
sudo ufw status
```

### 4. Create Data Directory

```bash
# As quilltap user
cd ~/quilltap

# Create data directory with proper permissions
mkdir -p data
chmod 755 data

# This directory will be populated by the application on first run
```

## Quick Start

### 1. Configure Environment Variables

```bash
# Copy environment template
cp .env.example .env.production

# Edit with your production values
nano .env.production
```

**Required variables:**

```env
# NextAuth (production domain)
NEXTAUTH_URL="https://yourdomain.com"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"

# Google OAuth (get from https://console.cloud.google.com/) - optional
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption (CRITICAL: back this up securely!)
ENCRYPTION_MASTER_PEPPER="$(openssl rand -base64 32)"

# MongoDB (REQUIRED)
MONGODB_URI="mongodb://localhost:27017"
MONGODB_DATABASE="quilltap"

# S3 Storage (REQUIRED)
# For embedded MinIO (development):
S3_MODE="embedded"

# For external S3 (production):
# S3_MODE="external"
# S3_ENDPOINT="https://s3.amazonaws.com"  # or your MinIO endpoint
# S3_REGION="us-east-1"
# S3_ACCESS_KEY="your-access-key"
# S3_SECRET_KEY="your-secret-key"
# S3_BUCKET="quilltap-files"

# SSL
DOMAIN="yourdomain.com"
SSL_EMAIL="admin@yourdomain.com"
```

### 2. Setup Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Go to Credentials → Create Credentials → OAuth client ID
5. Application type: Web application
6. Authorized redirect URIs:
   - `https://yourdomain.com/api/auth/callback/google`
7. Copy Client ID and Client Secret to `.env.production`

### 3. Initialize SSL Certificates

```bash
# Make script executable
chmod +x docker/init-letsencrypt.sh

# Run SSL initialization
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com
```

This script will:
1. Download recommended TLS parameters
2. Create a dummy certificate
3. Start Nginx
4. Obtain real Let's Encrypt certificate
5. Reload Nginx with proper certificate

**Note**: This may take 1-2 minutes on first run.

### 4. Start Application

```bash
# Start all services (app + nginx)
docker compose -f docker-compose.prod.yml up -d

# Verify it's running
docker compose -f docker-compose.prod.yml ps

# Check logs
docker compose -f docker-compose.prod.yml logs -f app
```

Your application should now be available at `https://yourdomain.com` with auto-renewing SSL certificate.

## SSL Configuration

### Automatic SSL with Let's Encrypt

The `init-letsencrypt.sh` script automates SSL setup:

```bash
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com
```

### Verify SSL Certificate

```bash
# Check certificate details
docker compose -f docker-compose.prod.yml exec nginx \
  openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -text

# Check certificate expiry
docker compose -f docker-compose.prod.yml exec nginx \
  openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -noout -dates
```

### Manual Certificate Renewal

```bash
# Force renewal (usually automatic)
docker compose -f docker-compose.prod.yml exec nginx \
  certbot renew --force-renewal

# Restart Nginx after renewal
docker compose -f docker-compose.prod.yml restart nginx
```

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXTAUTH_URL` | Your production domain | `https://yourdomain.com` |
| `NEXTAUTH_SECRET` | Secret for NextAuth (32+ chars) | `$(openssl rand -base64 32)` |
| `ENCRYPTION_MASTER_PEPPER` | Master encryption key (32+ chars) | `$(openssl rand -base64 32)` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `MONGODB_DATABASE` | MongoDB database name | `quilltap` |
| `DOMAIN` | Your domain for SSL | `yourdomain.com` |
| `SSL_EMAIL` | Email for SSL renewal notifications | `admin@yourdomain.com` |

### S3 Storage (Required)

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_MODE` | Storage mode (`embedded` or `external`) | `embedded` |
| `S3_ENDPOINT` | S3 endpoint URL (for external mode) | - |
| `S3_REGION` | S3 region | `us-east-1` |
| `S3_ACCESS_KEY` | S3 access key (for external mode) | - |
| `S3_SECRET_KEY` | S3 secret key (for external mode) | - |
| `S3_BUCKET` | S3 bucket name | `quilltap-files` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console (for OAuth) | - |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console (for OAuth) | - |
| `AUTH_DISABLED` | Disable authentication entirely | `false` |
| `LOG_LEVEL` | Logging level | `info` |
| `NODE_ENV` | Environment | `production` |

**CRITICAL SECURITY NOTES:**

1. **Backup `ENCRYPTION_MASTER_PEPPER`** - If lost, all encrypted API keys are unrecoverable
2. **Use strong values** - Generate with `openssl rand -base64 32`
3. **Keep `.env.production` secret** - Never commit to version control
4. **Restrict file permissions** - `chmod 600 .env.production`

## Data Management

All application data is stored in MongoDB and S3-compatible storage:

### MongoDB Collections

- `users` - User accounts and authentication
- `characters` - Character definitions
- `personas` - User personas
- `chats` - Chat metadata and messages
- `files` - File metadata (actual files in S3)
- `tags` - Tag definitions
- `memories` - Character memory data
- `connectionProfiles` - LLM connection configurations
- `embeddingProfiles` - Embedding provider configurations
- `imageProfiles` - Image generation configurations

### S3 Storage Structure

Files are stored in S3 with the following structure:

- `users/{userId}/files/` - User-uploaded files
- `users/{userId}/images/` - Generated and uploaded images

### Storage Monitoring

For MongoDB:

```bash
# Check database size
mongosh quilltap --eval "db.stats()"

# Check collection sizes
mongosh quilltap --eval "db.getCollectionNames().forEach(c => print(c + ': ' + db[c].stats().size))"
```

For S3/MinIO:

```bash
# Using AWS CLI
aws s3 ls s3://quilltap-files --recursive --summarize

# Using MinIO client
mc du myminio/quilltap-files
```

### Storage Recommendations

- **Small deployment (< 100 users)**: 10-20 GB (MongoDB) + 10-50 GB (S3)
- **Medium deployment (100-1000 users)**: 50-100 GB (MongoDB) + 100-500 GB (S3)
- **Large deployment (1000+ users)**: 200+ GB (MongoDB) + 1+ TB (S3)

Consider using MongoDB Atlas and AWS S3 for easier scaling.

## Monitoring

### Check Application Status

```bash
# View running containers
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f app

# View specific service logs
docker compose -f docker-compose.prod.yml logs -f nginx
```

### Application Health Check

```bash
# Check if app is responding
curl https://yourdomain.com/api/health

# Expected response: 200 OK
```

### Set Up Monitoring Alerts

For production, consider setting up monitoring:

```bash
# Using curl + cron to check health every 5 minutes
*/5 * * * * curl -f https://yourdomain.com/api/health || \
  mail -s "Quilltap health check failed" admin@yourdomain.com
```

### Resource Monitoring

```bash
# Monitor Docker resource usage
docker stats quilltap-app

# Check memory usage
docker compose -f docker-compose.prod.yml \
  exec app ps aux | grep node
```

## Backup Strategy

### Automated Daily Backups

```bash
#!/bin/bash
# /home/quilltap/backup-quilltap.sh

BACKUP_DIR="/home/quilltap/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MONGODB_URI="mongodb://localhost:27017/quilltap"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup MongoDB
mongodump --uri="$MONGODB_URI" --out="$BACKUP_DIR/mongo_$TIMESTAMP"
tar -czf "$BACKUP_DIR/quilltap_mongo_$TIMESTAMP.tar.gz" \
  -C "$BACKUP_DIR" "mongo_$TIMESTAMP"
rm -rf "$BACKUP_DIR/mongo_$TIMESTAMP"

# Backup S3 files (if using MinIO locally)
# mc mirror myminio/quilltap-files "$BACKUP_DIR/s3_$TIMESTAMP"

# Keep only last 7 days
find "$BACKUP_DIR" -name "quilltap_*.tar.gz" -mtime +7 -delete

# Log backup
echo "$(date): Backup completed: $TIMESTAMP" >> "$BACKUP_DIR/backup.log"
```

Add to crontab:

```bash
# Schedule daily backup at 2 AM
crontab -e
# Add: 0 2 * * * /home/quilltap/backup-quilltap.sh
```

### Remote Backup

```bash
#!/bin/bash
# Upload backup to remote server/cloud

BACKUP_FILE="$1"
REMOTE_BACKUP_DIR="/mnt/nas/quilltap-backups"

# Copy to NAS/Network share
cp "$BACKUP_FILE" "$REMOTE_BACKUP_DIR/"

# Or upload to S3
aws s3 cp "$BACKUP_FILE" s3://my-backups/quilltap/

# Or upload to Google Cloud Storage
gsutil cp "$BACKUP_FILE" gs://my-backups/quilltap/
```

### Verify Backups

```bash
# List recent backups
ls -lh ~/backups/quilltap_*.tar.gz | tail -10

# Verify MongoDB backup integrity
tar -tzf ~/backups/quilltap_mongo_20250120_120000.tar.gz | head

# Check backup size
du -h ~/backups/quilltap_*.tar.gz
```

See [Backup & Restore Guide](BACKUP-RESTORE.md) for detailed procedures.

## Updating

### Check for Updates

```bash
cd ~/quilltap

# Check available updates
git fetch origin
git log --oneline main..origin/main

# View changes
git diff main..origin/main
```

### Update Process

```bash
# 1. Backup current data
cp -r data/ data-backup-$(date +%Y%m%d)/

# 2. Pull latest code
git pull origin main

# 3. Rebuild Docker image
docker compose -f docker-compose.prod.yml build

# 4. Restart services
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# 5. Verify it's working
docker compose -f docker-compose.prod.yml logs -f app
curl https://yourdomain.com/api/health
```

### Rollback (If Needed)

```bash
# If something goes wrong, rollback
git checkout HEAD~1  # Go back one commit
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# Or restore from data backup
rm -rf data/
cp -r data-backup-20250120/ data/
docker compose -f docker-compose.prod.yml restart app
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs app

# Common issues:
# - Port 3000 already in use
# - ENCRYPTION_MASTER_PEPPER not set
# - MongoDB not accessible
# - S3/MinIO not accessible
# - .env.production missing required variables

# Check MongoDB connection
mongosh --eval "db.runCommand('ping')"

# Check MinIO health (if using embedded)
curl -f http://localhost:9000/minio/health/ready

# Fix permissions
chmod 600 .env.production

# Restart
docker compose -f docker-compose.prod.yml restart app
```

### SSL Certificate Issues

```bash
# Check certificate renewal status
docker compose -f docker-compose.prod.yml exec nginx \
  certbot renew --dry-run

# Force renewal
docker compose -f docker-compose.prod.yml exec nginx \
  certbot renew --force-renewal

# Restart Nginx
docker compose -f docker-compose.prod.yml restart nginx
```

### High Memory Usage

```bash
# Check memory usage
docker stats quilltap-app

# If high, restart the app
docker compose -f docker-compose.prod.yml restart app

# Check for large files in data/
du -sh data/* | sort -h
```

### Data Not Persisting

```bash
# Check MongoDB connection
mongosh quilltap --eval "db.users.countDocuments()"

# Check S3 connection
aws s3 ls s3://quilltap-files/ --endpoint-url http://localhost:9000

# For MinIO, check bucket exists
mc ls myminio/quilltap-files

# Check application logs for connection errors
docker compose -f docker-compose.prod.yml logs app | grep -i error
```

### Cannot Connect to Domain

```bash
# Check DNS resolution
nslookup yourdomain.com

# Verify firewall allows traffic
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Check if app is running
docker compose -f docker-compose.prod.yml ps

# Check if port 80/443 are in use
sudo netstat -tlnp | grep 80
sudo netstat -tlnp | grep 443
```

## Production Checklist

Before going live, verify:

- [ ] SSL certificate is valid (`curl -v https://yourdomain.com`)
- [ ] All environment variables are set correctly
- [ ] MongoDB is accessible and has proper authentication
- [ ] S3/MinIO is accessible and bucket exists
- [ ] MongoDB backup is scheduled
- [ ] S3 backup/replication is configured
- [ ] Monitoring/alerts are configured
- [ ] Encryption key is securely backed up
- [ ] Firewall rules are configured
- [ ] Google OAuth redirect URI is correct (if using OAuth)
- [ ] Application health check is working
- [ ] Logs are being monitored

## Performance Tuning

### Docker Resource Limits

For high-traffic deployments, set resource limits in docker-compose.prod.yml:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Nginx Caching

The included Nginx config already has caching for:
- Static assets (30 days)
- API responses (5 minutes)
- Images (1 day)

No additional tuning usually needed.

## Support & Resources

- **Documentation**: [README.md](../README.md)
- **Migration Guide**: [MIGRATION.md](MIGRATION.md)
- **Backup Guide**: [BACKUP-RESTORE.md](BACKUP-RESTORE.md)
- **GitHub Issues**: https://github.com/foundry-9/quilltap/issues
- **Email Support**: charles@sebold.tech

## Security Checklist

- [ ] SSH key-only authentication (no password login)
- [ ] Firewall configured (UFW or similar)
- [ ] Regular security updates (`apt update && apt upgrade`)
- [ ] Strong encryption key (32+ characters)
- [ ] Environment file protected (600 permissions)
- [ ] Backups stored off-server
- [ ] SSL certificate auto-renewal verified
- [ ] Rate limiting enabled (default)
- [ ] NEXTAUTH_SECRET is strong (32+ characters)
- [ ] No Quilltap sensitive files in version control

That's it! Your Quilltap instance is now running securely in production with MongoDB and S3-compatible storage.
