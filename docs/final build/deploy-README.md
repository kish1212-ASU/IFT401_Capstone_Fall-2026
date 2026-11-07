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

## Redeploy after a merge
Anyone with SSH access can do this. Merge the pull request into `main` first.

```bash
ssh -i <key>.pem ec2-user@<ec2-public-ip>
cd ~/IFT401_Capstone_Fall-2026
git status                       # should be clean; .env is not tracked
git pull
(cd api && npm install)          # only needed if api/package.json changed
(cd generator && npm install)    # only needed if generator/package.json changed
sudo systemctl restart stocktrader-api          # if anything in api/ changed
sudo systemctl restart stocktrader-generator    # if anything in generator/ changed
sudo systemctl status stocktrader-api --no-pager
journalctl -u stocktrader-api -n 20 --no-pager  # look for "API listening on 3000"
```

Check it worked. 200 from /health, and 401 from a protected route means the route exists (404 means old code is still running):

```bash
curl -s localhost:3000/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/orders
```

Changes in `web/` are static files: `git pull` is enough, no restart. Hard refresh the browser (Ctrl+Shift+R).

Do not:
- re-run `db/01-schema.sql` against RDS. It starts with `DROP TABLE` and wipes all data. Schema changes go in a new migration file run once.
- run `npm test` on the server. `.env` points at RDS, so the tests would write test users and orders into the real database.

## Demo prep (final video)
- Open the market for recording: `UPDATE market_config SET is_open_override=TRUE WHERE config_id=1;` in psql. Set it back to `NULL` afterward.
- If the instance is stopped and started, the public IP changes (no Elastic IP). Update `ALLOWED_ORIGIN` in `.env`, restart the API, and use the new address.

## Known limitations
- HTTP only. We decided not to register a domain for the capstone, so there is no TLS certificate between the browser and the server. Passwords are still hashed, tokens expire after 4 hours, and the database connection itself uses TLS. Production fix: a domain in Route 53, an Elastic IP, and a Let's Encrypt certificate in nginx (or an ALB with an ACM certificate).
- Single instance and single-AZ database; production would add an ALB, Auto Scaling and Multi-AZ RDS.
- No alarm on the generator process itself; systemd `Restart=always` covers crashes.
