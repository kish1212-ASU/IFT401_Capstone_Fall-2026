# Stock Trading System - IFT 401

Client/server stock trading application. Node/Express API, PostgreSQL
backend, random stock price generator. Deploys to AWS (EC2 + RDS).

See /docs/api-contract.md for endpoint definitions.

## Structure
- /api - Node/Express API server
- /web - customer and admin frontend
- /db - schema and seed SQL (runs automatically on first DB start)
- /generator - random stock price generator
- /docs - API contract, open questions, AWS runbook

## Prerequisites
- Git
- Docker Desktop (must be running before any docker command works)
- Node.js LTS

Windows note: if npm fails with "running scripts is disabled on this
system", run this once. No admin rights needed.

    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

## Setup

1. Clone and enter the repo. Do not put it inside OneDrive.

2. Copy the env template at the repo root:

    Windows:  copy .env.example .env
    Mac:      cp .env.example .env

3. Start PostgreSQL:

    docker compose up -d
    docker compose ps

   Wait for status to show healthy. The files in /db run automatically
   the first time the volume is created, so the schema and seed data
   load on their own.

4. Verify the data loaded (8 stocks expected):

    docker exec -it stocktrader-db psql -U trader -d stocktrader -c "SELECT ticker, current_price FROM stocks;"

5. Start the API:

    cd api
    npm install
    node server.js

6. Confirm it works:

    curl http://localhost:3000/health
    curl http://localhost:3000/stocks

## Local environment
- PostgreSQL: localhost:5433 (5433 on purpose, avoids colliding with a
  native Postgres install on 5432)
- API: localhost:3000
- DB name stocktrader, user trader, password localdev (local only)

## Resetting the database
Schema changes will not apply to an existing volume. Wipe and recreate:

    docker compose down -v
    docker compose up -d

The -v is required. Without it the old volume survives and the SQL in
/db is skipped.

## Schema status
/db/01-schema.sql is a DRAFT proposal pending Alex sign-off. Open
questions are noted in the file header and in /docs/open-questions.md.
Do not treat column names as final until confirmed.

## Branch naming
feature/<name>-<thing> - e.g. feature/kyle-price-generator

## Troubleshooting
- "not a git repository" - you are in the parent folder, cd into the repo
- "docker not recognized" - Docker Desktop is not running, or you need a
  new terminal after installing
- Postgres starts but has no tables - a SQL error during init. Check
  docker compose logs db, fix, then down -v and up again
