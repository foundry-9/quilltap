# Quilltap Production Deployment Guide

This guide covers deploying Quilltap to a production environment with Docker, Nginx, and SSL.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [Installation](#installation)
- [SSL Configuration](#ssl-configuration)
- [Environment Variables](#environment-variables)
- [Database Management](#database-management)
- [Monitoring](#monitoring)
- [Backup Strategy](#backup-strategy)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Server Requirements

- **Operating System**: Ubuntu 20.04+ or Debian 11+ (recommended)
- **RAM**: Minimum 2GB, recommended 4GB+
- **Storage**: Minimum 20GB SSD
- **CPU**: 2+ cores recommended
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

## Installation

### 1. Configure Environment Variables

```bash
# Copy production environment template
cp .env.production.example .env.production

# Edit with your values
nano .env.production
```

**Required variables:**

```env
# Database
DB_NAME="quilltap"
DB_USER="postgres"
DB_PASSWORD="CHANGE_THIS_STRONG_PASSWORD"

# NextAuth
NEXTAUTH_URL="https://yourdomain.com"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"

# Google OAuth (get from https://console.cloud.google.com/)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption (CRITICAL: backup this value!)
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

### 3. Build Application

```bash
# Build Docker images
docker compose -f docker-compose.prod.yml build
```

### 4. Initialize Database

```bash
# Start database only
docker compose -f docker-compose.prod.yml up -d db

# Wait for database to be ready
sleep 10

# Run migrations
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy

# Generate Prisma client
docker compose -f docker-compose.prod.yml run --rm app npx prisma generate
```

## SSL Configuration

### Automatic SSL with Let's Encrypt

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

### SSL Certificate Renewal

Certificates auto-renew via Certbot container (runs every 12 hours).

**Manual renewal:**
```bash
docker compose -f docker-compose.prod.yml run --rm certbot renew
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

**Check certificate expiry:**
```bash
docker compose -f docker-compose.prod.yml run --rm certbot certificates
```

## Environment Variables

### Critical Variables

**Never lose these values:**

- `ENCRYPTION_MASTER_PEPPER` - Required to decrypt API keys
- `NEXTAUTH_SECRET` - Required for authentication

**Backup strategy:**
```bash
# Create encrypted backup of .env.production
gpg -c .env.production
# Store .env.production.gpg in a secure location
```

### Optional Variables

```env
# Rate Limiting
RATE_LIMIT_API_MAX=100
RATE_LIMIT_API_WINDOW=10
RATE_LIMIT_AUTH_MAX=5
RATE_LIMIT_AUTH_WINDOW=60
RATE_LIMIT_CHAT_MAX=20
RATE_LIMIT_CHAT_WINDOW=60
RATE_LIMIT_GENERAL_MAX=100
RATE_LIMIT_GENERAL_WINDOW=60

# Logging
LOG_LEVEL=info  # Options: error, warn, info, debug
```

## Database Management

### Access Database

```bash
# PostgreSQL CLI
docker compose -f docker-compose.prod.yml exec db psql -U postgres quilltap

# Prisma Studio (web UI)
docker compose -f docker-compose.prod.yml run --rm -p 5555:5555 app npx prisma studio
# Visit http://your-server-ip:5555
```

### Run Migrations

```bash
# Deploy pending migrations
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy

# Create new migration (development only)
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate dev
```

## Monitoring

### Health Check

```bash
# Check application health
curl https://yourdomain.com/api/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2025-01-19T12:00:00.000Z",
#   "uptime": 86400,
#   "environment": "production",
#   "database": "connected"
# }
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f db
docker compose -f docker-compose.prod.yml logs -f nginx

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail=100 app
```

### Service Status

```bash
# Check running containers
docker compose -f docker-compose.prod.yml ps

# Check resource usage
docker stats
```

### Log Rotation

Configure log rotation to prevent disk filling:

```bash
# Create logrotate config
sudo nano /etc/logrotate.d/docker-containers

# Add:
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  size=10M
  missingok
  delaycompress
  copytruncate
}
```

## Backup Strategy

### Automated Backups

Set up automated daily backups:

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /home/quilltap/quilltap && ./docker/scripts/backup-database.sh >> /var/log/quilltap-backup.log 2>&1
```

### Manual Backup

```bash
# Create backup
./docker/scripts/backup-database.sh

# Create named backup
./docker/scripts/backup-database.sh important-backup
```

Backups are stored in `./backups/` directory.

### Restore from Backup

```bash
# List available backups
ls -lh backups/

# Restore (WARNING: overwrites current database)
./docker/scripts/restore-database.sh backups/quilltap_20250119_120000.sql.gz
```

### Off-site Backup

**Option 1: AWS S3**
```bash
# Install AWS CLI
sudo apt install awscli -y

# Configure
aws configure

# Upload backup
aws s3 cp backups/ s3://your-bucket/quilltap-backups/ --recursive
```

**Option 2: rsync to remote server**
```bash
# Sync backups to remote server
rsync -avz backups/ user@backup-server:/backups/quilltap/
```

## Updating

### Update Application Code

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose -f docker-compose.prod.yml up -d --build

# Run migrations
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy

# Verify health
curl https://yourdomain.com/api/health
```

### Update Dependencies

```bash
# Update npm packages
docker compose -f docker-compose.prod.yml run --rm app npm update

# Rebuild
docker compose -f docker-compose.prod.yml up -d --build
```

### Zero-Downtime Updates (Advanced)

For zero-downtime updates, use multiple app instances with a load balancer:

```bash
# Scale app to 2 instances
docker compose -f docker-compose.prod.yml up -d --scale app=2

# Update and rebuild
git pull
docker compose -f docker-compose.prod.yml build app

# Rolling restart
docker compose -f docker-compose.prod.yml up -d --no-deps --scale app=2 app
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs app

# Verify environment variables
docker compose -f docker-compose.prod.yml config

# Rebuild from scratch
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d
```

### Database Connection Issues

```bash
# Check database is running
docker compose -f docker-compose.prod.yml ps db

# Check database logs
docker compose -f docker-compose.prod.yml logs db

# Verify connection
docker compose -f docker-compose.prod.yml exec db pg_isready -U postgres

# Test connection from app
docker compose -f docker-compose.prod.yml exec app sh -c 'npx prisma db push --skip-generate'
```

### SSL Certificate Issues

```bash
# Check Nginx configuration
docker compose -f docker-compose.prod.yml exec nginx nginx -t

# View Nginx error logs
docker compose -f docker-compose.prod.yml logs nginx

# Re-run SSL initialization
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com

# Check certificate files
ls -la certbot/conf/live/yourdomain.com/
```

### High Memory Usage

```bash
# Check memory usage
docker stats

# Restart services
docker compose -f docker-compose.prod.yml restart

# Add swap space if needed
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Performance Issues

```bash
# Check server resources
htop

# Check disk space
df -h

# Check database size
docker compose -f docker-compose.prod.yml exec db \
  psql -U postgres -c "SELECT pg_size_pretty(pg_database_size('quilltap'));"

# Optimize database
docker compose -f docker-compose.prod.yml exec db \
  psql -U postgres quilltap -c "VACUUM ANALYZE;"
```

### Reset Everything (Last Resort)

```bash
# WARNING: This deletes all data!
docker compose -f docker-compose.prod.yml down -v
docker system prune -a --volumes
# Then start fresh installation
```

## Security Checklist

- [ ] Strong passwords for database
- [ ] Firewall configured (UFW)
- [ ] SSH key-only authentication
- [ ] SSL certificates installed and auto-renewing
- [ ] Environment variables secured
- [ ] Regular backups enabled
- [ ] Log rotation configured
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] Regular updates scheduled

## Support

- **Documentation**: See `/docs` directory
- **Issues**: https://github.com/foundry-9/quilltap/issues
- **Security**: Report security issues privately to security@foundry-9.com

## License

MIT License - see LICENSE file for details
