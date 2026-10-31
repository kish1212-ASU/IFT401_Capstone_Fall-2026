# AWS Deployment (Kyle Kishineff, Oct 31 2026)

Single-AZ, free-tier MVP matching the SAD. Region us-east-1, default VPC.

## Resources
| Resource | Name / setting |
|---|---|
| Security group (web) | `stocktrader-web-sg`: 80/443 from anywhere, 22 from admin IP only |
| Security group (db) | `stocktrader-db-sg`: 5432 from `stocktrader-web-sg` only |
| RDS | `stocktrader-db`, PostgreSQL 18, db.t4g.micro, 20 GiB, single-AZ, not public, encrypted, 1-day automated backup (free plan limit) |
| EC2 | `stocktrader-web`, Amazon Linux 2023, t3.micro, 10 GiB gp3 |
| IAM role | `stocktrader-ec2-role`: S3 put/list on the backup bucket only (`iam-ec2-backup-policy.json`) |
| S3 | `stocktrader-backups-743434961847` (public access blocked), nightly dumps under `db/` |
| SNS | `stocktrader-alerts` (email) |
| CloudWatch alarms | `stocktrader-web-system-failed` (auto-recover + email), `stocktrader-web-cpu-high` (>80% CPU, email) |

## Server setup (EC2)
1. `sudo dnf install -y nodejs22 nodejs22-npm git nginx cronie postgresql18`
2. `curl -o ~/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`
3. Clone repo, then `(cd api && npm install) && (cd generator && npm install)`
4. Load schema: `psql "<conn string>" -f db/01-schema.sql` then `db/02-seed.sql`; delete the placeholder-hash users and create real ones through `POST /users`.
5. Create `.env` in the repo root (never committed, `chmod 600`):
   ```
   DATABASE_URL=postgres://trader:<PASSWORD>@<rds-endpoint>:5432/stocktrader?sslmode=verify-full&sslrootcert=/home/ec2-user/global-bundle.pem
   JWT_SECRET=<openssl rand -hex 32>
   ALLOWED_ORIGIN=http://<ec2-public-ip>
   PORT=3000
   ```
6. Copy `stocktrader-api.service` and `stocktrader-generator.service` to `/etc/systemd/system/`, then `sudo systemctl daemon-reload && sudo systemctl enable --now stocktrader-api stocktrader-generator`
7. Copy `nginx-stocktrader.conf` to `/etc/nginx/conf.d/stocktrader.conf`, comment out the default `server { }` block in `/etc/nginx/nginx.conf`, `chmod 711 /home/ec2-user`, `sudo systemctl enable --now nginx`
8. Front end calls the API at `/api` (nginx strips the prefix).
9. Backups: put `backup.sh` in `~`, `chmod 700`, create `~/.pgpass` (`host:5432:stocktrader:trader:<PASSWORD>`, `chmod 600`), and add cron `0 7 * * * /home/ec2-user/backup.sh >> /home/ec2-user/backup.log 2>&1`

## Known limitations
- HTTP only (no domain/certificate yet).
- Single instance and single-AZ database; production would add an ALB, Auto Scaling and Multi-AZ RDS.
- No alarm on the generator process itself; systemd `Restart=always` covers crashes.
