# Stock Trading System - IFT 401

This is our capstone project. It's a client/server stock trading app where
customers can buy and sell stocks and admins can create stocks and set market
hours. Node/Express API, PostgreSQL database, plus a background job that moves
stock prices around during the trading day. It'll get deployed to AWS (EC2 and
RDS) in November.

I set up the repo and the local environment so nobody has to spend a night
figuring out Postgres. If you follow the setup section below you should have a
working database and a running API in about ten minutes.

## What's in here

    /api          Node/Express API server
    /web          customer and admin web pages
    /db           schema and seed SQL, runs automatically when the DB starts
    /generator    random stock price generator
    /docs         API contract, open questions, AWS runbook

## What you need installed

Git, Docker Desktop, and Node.js LTS. On Windows, winget handles all three:

    winget install --id Git.Git -e
    winget install --id Docker.DockerDesktop -e
    winget install --id OpenJS.NodeJS.LTS -e

Two things that got me and will probably get you:

Every one of these needs a brand new terminal window afterward before the
command shows up. Docker also wants a reboot, and Docker Desktop has to
actually be running in your system tray before any docker command works.

If npm gives you "running scripts is disabled on this system," that's
PowerShell blocking the npm wrapper. Run this once, no admin needed:

    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

## Setup

1. Clone it somewhere that isn't OneDrive. OneDrive syncs the .git folder while
   Git is writing to it and you get lock errors and weird corruption. I keep
   mine at `C:\Users\<you>\IFT401`.

        git clone https://github.com/kish1212-ASU/IFT401_Capstone_Fall-2026.git
        cd IFT401_Capstone_Fall-2026

2. Copy the env template at the repo root.

        Windows:  copy .env.example .env
        Mac:      cp .env.example .env

   The real .env is gitignored on purpose. Never commit it. Once we have AWS
   credentials in there it becomes a real problem, and anything committed to Git
   stays in the history even after you delete it.

3. Start the database.

        docker compose up -d
        docker compose ps

   Wait for the status to say healthy. The SQL files in /db run automatically
   the first time the volume gets created, so the tables and the seed data load
   on their own. You don't have to do anything manually.

4. Check that it worked. You should get 8 stocks back.

        docker exec -it stocktrader-db psql -U trader -d stocktrader -c "SELECT ticker, current_price FROM stocks;"

5. Start the API.

        cd api
        npm install
        npm start

6. Hit it in your browser or with curl.

        http://localhost:3000/health
        http://localhost:3000/stocks

   /health returns ok only if the API can actually reach the database, so if
   that one passes you know the whole chain is working.

## Local setup details

    PostgreSQL    localhost:5433
    API           localhost:3000
    database      stocktrader
    user          trader
    password      localdev

Postgres is on 5433 instead of the usual 5432 on purpose. If you already have
Postgres installed natively it owns 5432 and the container will silently fail
to bind. The password is fine to have in the repo since the container isn't
reachable from outside your machine.

## Resetting the database

This is the one that'll bite you. Schema changes do not apply to a database
that already exists. If Alex changes a table, or you're getting errors about
columns that should be there, wipe it and start over:

    docker compose down -v
    docker compose up -d

The -v is the important part. Without it the old volume survives and Postgres
skips the SQL in /db entirely, so it looks like your changes did nothing.

To just stop it overnight without losing data, use docker compose stop, then
docker compose start to bring it back.

## Heads up on the schema

/db/01-schema.sql is a draft I wrote so the environment would run. Alex owns
the data model, so treat the column names as not final until he signs off.
There are two open questions written into the header of that file:

Volume. The business case says volume is total shares purchased and market cap
is volume times price. That reads like a number that goes up every time someone
buys, which isn't what volume means on a real exchange and isn't something an
admin would set once at stock creation. I modeled it as static. If the trade
logic is supposed to increment it, we need to decide that before either of us
builds against it.

Daily price fields. Opening price, daily high, and daily low aren't in our ERD,
but the business case says we have to display them and my wireframe shows a
high/low panel. I put them as columns on stocks that reset at market open. A
separate daily price table is the other option and would give us price history
if we want to chart anything later.

Two conventions I did bake in and would rather not change: money is NUMERIC and
never float, because floating point rounding on cash balances drifts and you
won't notice until a portfolio total is off during the demo. And market hours
are stored as local clock time plus a named timezone rather than UTC, so 9:30
Eastern stays 9:30 Eastern through the November DST change.

## How we're working

Branches are `feature/<name>-<thing>`, so `feature/kyle-price-generator` or
`feature/daniel-portfolio-page`. Push your branch and open a PR rather than
committing straight to main. It's less about process and more about the three
of us not overwriting each other.

Keep SQL in a data access file, not inline in a route handler. /api/stocks.js
is the pattern. If the schema changes we only have to fix one place.

If you hit something confusing, put it in /docs/open-questions.md instead of
just working around it. Half of what's gone wrong so far was somebody assuming
something reasonable that turned out different from what the other person
assumed.

## When something breaks

"not a git repository" means you're in the parent folder. cd into the repo.

"docker is not recognized" means either Docker Desktop isn't running or you
need a fresh terminal after installing it.

Postgres starts fine but there are no tables. Something in the SQL errored
during startup and it failed quietly. Run docker compose logs db to see the
actual error, fix it, then down -v and up again.

The API starts but /stocks 500s. Usually the database isn't up yet, or you
never copied .env.example to .env.

Anything else, message me.
