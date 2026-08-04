# Quilltap Production Deployment Guide

## Overview

Quilltap uses **SQLite** for data storage and the **local filesystem** for files. SQLite is self-contained and requires no external database services. The Docker image is the recommended way to run Quilltap in production.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Host Port Forwarding](#host-port-forwarding)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Plugin Management](#plugin-management)
- [Data Management](#data-management)
- [Monitoring](#monitoring)
- [Backup Strategy](#backup-strategy)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Server Requirements

- **Operating System**: Any Linux distribution, macOS, or Windows with Docker support
- **RAM**: Minimum 2GB, recommended 4GB+
- **Storage**: Minimum 10GB SSD
- **CPU**: 2+ cores recommended
- **Docker**: Docker Engine 20.10+ or Docker Desktop

### Optional

- **Domain name** with DNS pointing to your server (for HTTPS)
- **Reverse proxy** (Nginx, Caddy, Traefik) for SSL termination

## Quick Start

### 1. Run the Container

```bash
docker run -d \
  --name quilltap \
  -p 3000:3000 \
  -v /path/to/data:/app/quilltap \
  foundry9/quilltap
```

Open `http://localhost:3000` and you're running. On first launch, you'll be guided through a setup wizard that generates your encryption key automatically.

### 2. Production Configuration

For a production deployment, configure additional environment variables:

```bash
docker run -d \
  --name quilltap \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /home/quilltap/data:/app/quilltap \
  -e BASE_URL="https://yourdomain.com" \
  foundry9/quilltap
```

**CRITICAL SECURITY NOTES:**

1. **Backup the `.dbkey` file** — The encryption pepper is auto-generated on first run and stored in `quilltap.dbkey` (and `quilltap-llm-logs.dbkey` for LLM logs) inside your data directory. Without this file, your encrypted databases cannot be decrypted. Use a persistent volume so the key file survives container rebuilds.
2. **Optional passphrase protection** — You can protect the `.dbkey` file with a passphrase via the setup wizard or settings. If set, the passphrase is required on every startup (or after an auto-lock timeout). If the `.dbkey` file is lost and a passphrase was set, the database is unrecoverable.
3. **Auto-lock** — Passphrase-protected instances support an idle timer that automatically locks the database after a configurable period of inactivity, requiring the passphrase to resume.

## Environment Variables

### Production

Only needed when exposing Quilltap on a custom domain. For local use, everything has sensible defaults.

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_URL` | Your production URL | `http://localhost:3000` |

### Networking

| Variable | Description | Default |
|----------|-------------|---------|
| `QUILLTAP_HOST_IP` | Override host gateway IP for localhost URL rewriting (Docker/Lima/WSL2) | Auto-detected |

### Encryption

| Variable | Description | Default |
|----------|-------------|---------|
| `ENCRYPTION_MASTER_PEPPER` | Master encryption key (optional, auto-generated via /setup) | Auto-generated |

### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `SQLITE_PATH` | Path to SQLite database file | `/app/quilltap/data/quilltap.db` |
| `SQLITE_WAL_MODE` | Enable Write-Ahead Logging | `true` |
| `SQLITE_BUSY_TIMEOUT` | Max wait for database locks (ms) | `5000` |

### Timezone

| Variable | Description | Default |
|----------|-------------|---------|
| `QUILLTAP_TIMEZONE` | IANA timezone name (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`) for timestamp injection. Auto-detected in Electron app. | System default (usually UTC in Docker) |
| `TZ` | Standard Unix timezone for the process clock. Governs the paths that read local time directly rather than the formatting chain: episodic day-references ("today"/"yesterday" recall windows), the autonomous-room daily token budget rollover at local midnight, and croner schedule evaluation. | System default (UTC in Docker) |

Setting either one in Docker is enough: the container entrypoint copies whichever is present into the other, with `QUILLTAP_TIMEZONE` winning if both are set and disagree. This mirrors what `lima/wsl-init.sh` does for the Lima and WSL2 shells. No `tzdata` package is needed — Node resolves `TZ` through its bundled ICU.

Setting only one *outside* the entrypoint (a bare `node server.js`, say) leaves the two halves disagreeing: chat timestamps on your clock, schedules and recall windows on UTC.

### Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (`error`, `warn`, `info`, `debug`) | `info` |
| `LOG_OUTPUT` | Where logs go (`console`, `file`, `both`) | `console` |
| `NODE_ENV` | Environment | `production` |

### Plugins

| Variable | Description | Default |
|----------|-------------|---------|
| `SITE_PLUGINS_ENABLED` | Comma-separated plugin IDs, or `all` | `all` |
| `SITE_PLUGINS_DISABLED` | Comma-separated plugin IDs to disable | (empty) |

## Accessing Host Services (Ollama, LM Studio, etc.)

If you run local services on your host machine (Ollama, LM Studio, MCP servers), Quilltap automatically rewrites `localhost` and `127.0.0.1` URLs to point at the host gateway IP. This means you can configure `http://localhost:11434` in the UI and it will work transparently in Docker, Lima VMs, and WSL2 — no manual port forwarding needed.

On Linux, add `--add-host` so the container can resolve the host IP:

```bash
docker run -d \
  --name quilltap \
  -p 3000:3000 \
  -v /path/to/data:/app/quilltap \
  --add-host=host.docker.internal:host-gateway \
  foundry9/quilltap
```

On **macOS and Windows**, Docker Desktop provides `host.docker.internal` automatically — no extra flags needed.

### Override Host IP

If automatic detection doesn't work in your environment, set the `QUILLTAP_HOST_IP` environment variable to the IP address of your host machine:

```bash
docker run -d \
  --name quilltap \
  -p 3000:3000 \
  -v /path/to/data:/app/quilltap \
  -e QUILLTAP_HOST_IP="192.168.1.100" \
  foundry9/quilltap
```

This override works in all environments (Docker, Lima, WSL2).

## Reverse Proxy Setup

For production with HTTPS, put a reverse proxy in front of Quilltap. Here are examples for common proxies:

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### Caddy

```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

Caddy handles SSL automatically via Let's Encrypt.

## Plugin Management

### npm-Installed Plugins in Docker

Plugins are stored in the data directory which is mounted from the host, so they persist across container restarts.

The volume mount includes the plugins directory:

```
/path/to/data/                   # Host data directory
├── data/                        # SQLite database
├── files/                       # User files
├── logs/                        # Application logs
└── plugins/
    └── npm/                     # npm-installed plugins
        ├── qtap-plugin-foo/
        │   └── node_modules/
        │       └── qtap-plugin-foo/
        │           └── manifest.json
        └── registry.json        # Tracks installed plugins
```

### Installing Plugins

Plugins can be installed via the Settings > Plugins page in the web UI, or via API:

```bash
curl -X POST https://yourdomain.com/api/v1/plugins?action=install \
  -H "Content-Type: application/json" \
  -d '{"packageName": "qtap-plugin-example"}'
```

After installing, restart the container to activate the plugin:

```bash
docker restart quilltap
```

## Data Management

Quilltap stores application data in two places:

1. **SQLite Database File** — All application data in a single file at `/app/quilltap/data/quilltap.db`
2. **File Storage** — Local filesystem for user files and images

### Storage Monitoring

```bash
# Check database file size
docker exec quilltap ls -lh /app/quilltap/data/quilltap.db

# Check database integrity
docker exec quilltap sqlite3 /app/quilltap/data/quilltap.db "PRAGMA integrity_check;"
```

## Monitoring

### Application Health Check

```bash
curl http://localhost:3000/api/health
# Expected response: 200 OK
```

### Container Status

```bash
# View container status
docker ps --filter name=quilltap

# View logs
docker logs -f quilltap

# Monitor resource usage
docker stats quilltap
```

### Set Up Monitoring Alerts

```bash
# Using curl + cron to check health every 5 minutes
*/5 * * * * curl -f http://yourdomain.com/api/health || \
  mail -s "Quilltap health check failed" admin@yourdomain.com
```

## Backup Strategy

### Automated Daily Backups

```bash
#!/bin/bash
# /home/quilltap/backup-quilltap.sh

BACKUP_DIR="/home/quilltap/backups"
DATA_DIR="/home/quilltap/data"  # Your mounted data directory
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup SQLite database (safe to copy while running due to WAL mode)
cp "$DATA_DIR/data/quilltap.db" "$BACKUP_DIR/quilltap_$TIMESTAMP.db"
tar -czf "$BACKUP_DIR/quilltap_$TIMESTAMP.db.tar.gz" \
  -C "$BACKUP_DIR" "quilltap_$TIMESTAMP.db"
rm "$BACKUP_DIR/quilltap_$TIMESTAMP.db"

# Keep only last 7 days
find "$BACKUP_DIR" -name "quilltap_*.db.tar.gz" -mtime +7 -delete

echo "$(date): Backup completed: $TIMESTAMP" >> "$BACKUP_DIR/backup.log"
```

Add to crontab:

```bash
crontab -e
# Add: 0 2 * * * /home/quilltap/backup-quilltap.sh
```

See [Backup & Restore Guide](BACKUP-RESTORE.md) for detailed procedures.

## Updating

### From Docker Hub

```bash
# Pull latest image
docker pull foundry9/quilltap:latest

# Stop and remove old container
docker stop quilltap
docker rm quilltap

# Start with new image (same arguments as before)
docker run -d \
  --name quilltap \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /home/quilltap/data:/app/quilltap \
  -e BASE_URL="https://yourdomain.com" \
  foundry9/quilltap:latest

# Verify it's working
docker logs -f quilltap
curl https://yourdomain.com/api/health
```

### Rollback

```bash
# If something goes wrong, use the previous image tag
docker stop quilltap
docker rm quilltap
docker run -d --name quilltap ... foundry9/quilltap:previous-version
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker logs quilltap

# Common issues:
# - Port 3000 already in use
# - Pepper vault needs setup (navigate to /setup)
# - .env variables missing required values
# - SQLite database file not writable (check volume permissions)

# Check container is running
docker ps --filter name=quilltap
```

### Permission Issues

```bash
# If SQLite database isn't writable, check ownership
ls -la /path/to/data/data/

# The container runs as uid 1001 (nextjs user)
# Ensure your data directory is writable by uid 1001
sudo chown -R 1001:1001 /path/to/data/
```

### High Memory Usage

```bash
# Check memory usage
docker stats quilltap

# If high, restart the container
docker restart quilltap

# The default Node.js heap limit is 2048 MB (set via NODE_OPTIONS).
# To increase it, override at runtime:
docker run -e NODE_OPTIONS="--max-old-space-size=4096" quilltap
```

### Data Not Persisting

```bash
# Verify volume mount is correct
docker inspect quilltap | grep -A 5 Mounts

# Check SQLite database contains data
docker exec quilltap sqlite3 /app/quilltap/data/quilltap.db "SELECT COUNT(*) FROM users;"
```

## Production Checklist

Before going live, verify:

- [ ] Data directory is mounted with proper permissions (uid 1001)
- [ ] `BASE_URL` is set to your production URL (if using a custom domain)
- [ ] Encryption key is securely backed up
- [ ] Reverse proxy is configured with SSL (if exposing to internet)
- [ ] SQLite database backup is scheduled
- [ ] Monitoring/alerts are configured
- [ ] Firewall rules are configured
- [ ] Application health check is working
- [ ] Container restart policy is set (`--restart unless-stopped`)

## Security Checklist

- [ ] SSH key-only authentication (no password login)
- [ ] Firewall configured (UFW or similar)
- [ ] Regular security updates
- [ ] Strong encryption key (32+ characters)
- [ ] SSL/TLS via reverse proxy
- [ ] Rate limiting via reverse proxy
- [ ] No sensitive files in version control
- [ ] Container running as non-root user (built-in)

## Support & Resources

- **Documentation**: [README.md](../README.md)
- **Backup Guide**: [BACKUP-RESTORE.md](BACKUP-RESTORE.md)
- **GitHub Issues**: https://github.com/foundry-9/quilltap-server/issues
- **Email Support**: charles.sebold@foundry-9.com
