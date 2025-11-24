# Quilltap Production Deployment Guide

## Overview

Quilltap is now deployed as a **single containerized application** with no external database required. All data is stored in JSON files within the `data/` directory, making deployment faster, simpler, and more portable.

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
- **RAM**: Minimum 1GB, recommended 2GB+
- **Storage**: Minimum 20GB SSD (for data growth)
- **CPU**: 1+ core (2+ recommended)
- **Network**: Public IP address with ports 80 and 443 accessible

### Domain Requirements

- Domain name pointing to your server's IP address
- DNS A record configured (allow 24-48 hours for propagation)

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

# Google OAuth (get from https://console.cloud.google.com/)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption (CRITICAL: back this up securely!)
ENCRYPTION_MASTER_PEPPER="$(openssl rand -base64 32)"

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
| `GOOGLE_CLIENT_ID` | From Google Cloud Console | `xxxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console | `xxxxx-xxxxx` |
| `ENCRYPTION_MASTER_PEPPER` | Master encryption key (32+ chars) | `$(openssl rand -base64 32)` |
| `DOMAIN` | Your domain for SSL | `yourdomain.com` |
| `SSL_EMAIL` | Email for SSL renewal notifications | `admin@yourdomain.com` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level | `info` |
| `NODE_ENV` | Environment | `production` |

**CRITICAL SECURITY NOTES:**

1. **Backup `ENCRYPTION_MASTER_PEPPER`** - If lost, all encrypted API keys are unrecoverable
2. **Use strong values** - Generate with `openssl rand -base64 32`
3. **Keep `.env.production` secret** - Never commit to version control
4. **Restrict file permissions** - `chmod 600 .env.production`

## Data Management

All application data is stored in the `data/` directory:

```
data/
├── characters/              # Character definitions
├── personas/               # User personas
├── chats/                 # Conversations and messages
├── auth/                  # Authentication (sessions, accounts)
├── settings/              # Application settings
├── image-profiles/        # Image configurations
└── binaries/              # User uploaded images
```

### Disk Usage Monitoring

```bash
# Check data directory size
du -sh ~/quilltap/data/

# Monitor in real-time
watch -n 5 'du -sh ~/quilltap/data/'

# List largest subdirectories
du -sh ~/quilltap/data/*
```

### Storage Recommendations

- **Small deployment (< 100 users)**: 5-10 GB
- **Medium deployment (100-1000 users)**: 20-50 GB
- **Large deployment (1000+ users)**: 100+ GB

Adjust server storage and monitoring accordingly.

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
DATA_DIR="/home/quilltap/quilltap/data"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup data
tar -czf "$BACKUP_DIR/quilltap_$TIMESTAMP.tar.gz" \
  -C "$DATA_DIR/.." data/

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

# Verify backup integrity
tar -tzf ~/backups/quilltap_20250120_120000.tar.gz | head

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
# - data/ directory not writable
# - .env.production missing required variables

# Fix permissions
chmod 755 data/
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
# Verify data directory exists
ls -la data/

# Check file permissions
chmod 755 data/

# Verify volume mount in docker-compose.prod.yml
docker inspect quilltap-app | grep -A 5 Mounts

# Check if container can write
docker compose -f docker-compose.prod.yml exec app \
  ls -la /app/data/
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
- [ ] Data directory is backed up
- [ ] Monitoring/alerts are configured
- [ ] Backup script is scheduled
- [ ] Encryption key is securely backed up
- [ ] Firewall rules are configured
- [ ] Google OAuth redirect URI is correct
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

That's it! Your Quilltap instance is now running securely in production with zero external dependencies.
