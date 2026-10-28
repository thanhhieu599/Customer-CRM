#!/usr/bin/env sh
# Daily PostgreSQL backup (keep 14 days). Cron on the VPS, e.g.:
#   15 2 * * * /opt/crm/deploy/backup.sh >> /var/log/crm-backup.log 2>&1
# Copy the backup folder off the server too (rclone to Google Drive / S3).
set -eu
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-/opt/crm-backups}
mkdir -p "$DIR"
FILE="$DIR/crm-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$FILE"
find "$DIR" -name 'crm-*.sql.gz' -mtime +14 -delete
echo "backup ok: $FILE"
# Restore test (do it monthly!):
#   gunzip -c FILE | docker compose exec -T postgres psql -U crm -d crm_restore_test
