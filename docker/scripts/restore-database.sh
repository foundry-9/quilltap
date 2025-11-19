#!/bin/bash

# Database Restore Script for Quilltap
# This script restores a PostgreSQL database from a backup
#
# Usage: ./restore-database.sh <backup-file>
# Example: ./restore-database.sh backups/quilltap_20250119_120000.sql.gz
#
# WARNING: This will OVERWRITE the current database!

set -e

# Configuration
COMPOSE_FILE="docker-compose.prod.yml"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check arguments
if [ -z "$1" ]; then
    echo -e "${RED}Error: No backup file specified${NC}"
    echo "Usage: $0 <backup-file>"
    echo "Example: $0 backups/quilltap_20250119_120000.sql.gz"
    exit 1
fi

BACKUP_FILE=$1

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

# Check if running in production mode
if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}Error: $COMPOSE_FILE not found${NC}"
    echo "Are you in the project root directory?"
    exit 1
fi

# Get database credentials from environment or use defaults
DB_NAME=${DB_NAME:-quilltap}
DB_USER=${DB_USER:-postgres}

echo -e "${RED}WARNING: This will OVERWRITE the current database!${NC}"
echo "Database: $DB_NAME"
echo "Backup file: $BACKUP_FILE"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${YELLOW}Restore cancelled${NC}"
    exit 0
fi

# Create a safety backup of current database
SAFETY_BACKUP="backups/pre-restore_$(date +%Y%m%d_%H%M%S).sql.gz"
echo -e "${YELLOW}Creating safety backup of current database...${NC}"
mkdir -p backups
docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U "$DB_USER" "$DB_NAME" | \
    gzip > "$SAFETY_BACKUP"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Safety backup created: $SAFETY_BACKUP${NC}"
else
    echo -e "${RED}✗ Safety backup failed. Aborting restore.${NC}"
    exit 1
fi

# Stop the application to prevent database access during restore
echo -e "${YELLOW}Stopping application...${NC}"
docker compose -f "$COMPOSE_FILE" stop app

# Drop existing connections and recreate database
echo -e "${YELLOW}Preparing database for restore...${NC}"
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" postgres <<-EOSQL
    -- Terminate existing connections
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = '$DB_NAME'
      AND pid <> pg_backend_pid();

    -- Drop and recreate database
    DROP DATABASE IF EXISTS $DB_NAME;
    CREATE DATABASE $DB_NAME;
EOSQL

# Restore the backup
echo -e "${YELLOW}Restoring backup...${NC}"
gunzip -c "$BACKUP_FILE" | docker compose -f "$COMPOSE_FILE" exec -T db \
    psql -U "$DB_USER" "$DB_NAME"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database restored successfully${NC}"
else
    echo -e "${RED}✗ Restore failed${NC}"
    echo -e "${YELLOW}You can try to restore from safety backup: $SAFETY_BACKUP${NC}"
    exit 1
fi

# Run migrations to ensure schema is up to date
echo -e "${YELLOW}Running database migrations...${NC}"
docker compose -f "$COMPOSE_FILE" run --rm app npx prisma migrate deploy

# Restart the application
echo -e "${YELLOW}Restarting application...${NC}"
docker compose -f "$COMPOSE_FILE" up -d app

# Verify application is healthy
echo -e "${YELLOW}Waiting for application to be ready...${NC}"
sleep 5

# Check if app is responding
if docker compose -f "$COMPOSE_FILE" exec app wget --no-verbose --tries=1 --spider http://localhost:3000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Application is healthy${NC}"
else
    echo -e "${YELLOW}Warning: Application may not be fully ready yet${NC}"
    echo "Check logs with: docker compose -f $COMPOSE_FILE logs app"
fi

echo -e "${GREEN}Restore process completed!${NC}"
echo "Safety backup saved at: $SAFETY_BACKUP"
