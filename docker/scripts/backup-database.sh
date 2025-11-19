#!/bin/bash

# Database Backup Script for Quilltap
# This script creates a backup of the PostgreSQL database
#
# Usage: ./backup-database.sh [backup-name]
# Example: ./backup-database.sh manual-backup
#
# If no name is provided, uses timestamp

set -e

# Configuration
BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME=${1:-"quilltap_$DATE"}
COMPOSE_FILE="docker-compose.prod.yml"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running in production mode
if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}Error: $COMPOSE_FILE not found${NC}"
    echo "Are you in the project root directory?"
    exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}Starting database backup...${NC}"
echo "Backup name: $BACKUP_NAME"
echo "Backup directory: $BACKUP_DIR"

# Get database credentials from environment or use defaults
DB_NAME=${DB_NAME:-quilltap}
DB_USER=${DB_USER:-postgres}

# Create the backup
echo -e "${YELLOW}Creating backup...${NC}"
docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U "$DB_USER" "$DB_NAME" | \
    gzip > "$BACKUP_DIR/${BACKUP_NAME}.sql.gz"

if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_DIR/${BACKUP_NAME}.sql.gz" | cut -f1)
    echo -e "${GREEN}✓ Backup completed successfully${NC}"
    echo "Location: $BACKUP_DIR/${BACKUP_NAME}.sql.gz"
    echo "Size: $BACKUP_SIZE"
else
    echo -e "${RED}✗ Backup failed${NC}"
    exit 1
fi

# Optional: Clean up old backups (keep last 7 days)
echo -e "${YELLOW}Cleaning up old backups (keeping last 7 days)...${NC}"
find "$BACKUP_DIR" -name "quilltap_*.sql.gz" -mtime +7 -delete

# Count remaining backups
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "*.sql.gz" | wc -l)
echo -e "${GREEN}Total backups: $BACKUP_COUNT${NC}"

# Optional: Upload to cloud storage (uncomment and configure as needed)
# echo -e "${YELLOW}Uploading to cloud storage...${NC}"
# aws s3 cp "$BACKUP_DIR/${BACKUP_NAME}.sql.gz" "s3://your-bucket/backups/"
# gcloud storage cp "$BACKUP_DIR/${BACKUP_NAME}.sql.gz" "gs://your-bucket/backups/"

echo -e "${GREEN}Backup process completed!${NC}"
