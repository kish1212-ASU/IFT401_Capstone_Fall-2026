#!/bin/bash
# Nightly PostgreSQL backup to S3. Password comes from ~/.pgpass (never stored in this file).
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
FILE=/home/ec2-user/backups/stocktrader-$STAMP.sql.gz
pg_dump "host=stocktrader-db.cch8qokomvmh.us-east-1.rds.amazonaws.com port=5432 dbname=stocktrader user=trader sslmode=verify-full sslrootcert=/home/ec2-user/global-bundle.pem" | gzip > "$FILE"
aws s3 cp "$FILE" s3://stocktrader-backups-743434961847/db/
find /home/ec2-user/backups -name '*.sql.gz' -mtime +3 -delete
echo "$(date) backup ok: $FILE"
