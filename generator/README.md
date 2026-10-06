# Random stock price generator

A background job that moves stock prices during the trading day. It is not an
HTTP route. It connects to the database directly, the same way the API does.

Each cycle (every 3 seconds by default) it:

1. Checks whether the market is open, using the hours, time zone, trading days
   and holidays in `market_config` (the same rules as GET /market).
2. If it is open, moves the price of every active stock up or down a little.
3. Keeps the day's opening price, high and low up to date.

If the market is closed it does nothing and waits.

## Running it

The database has to be up first.

    docker compose up -d
    cd generator
    npm install
    npm start

You will see a line per cycle with each stock's new price and the change.
Ctrl+C stops it.

It reads `DATABASE_URL` from the `.env` file at the repo root, same as the API.

## Demoing outside market hours

The market is only open 9:30 to 4:00 Eastern on weekdays, so outside that the
generator just waits. To force the market open for a demo:

    docker exec -it stocktrader-db psql -U trader -d stocktrader -c "UPDATE market_config SET is_open_override = TRUE WHERE config_id = 1;"

Put it back on the normal schedule when you are done:

    docker exec -it stocktrader-db psql -U trader -d stocktrader -c "UPDATE market_config SET is_open_override = NULL WHERE config_id = 1;"

Setting it to FALSE closes the market no matter what time it is.

## How prices move

- Every tick is a small random move, about 0.2% by default.
- On top of that each stock has a slow drift that lasts a few dozen ticks, so
  it trends up or down for a while instead of jittering around one number.
- A gentle pull toward the stock's initial price keeps it from wandering off
  over several days.
- Prices are whole cents, never move more than 5% in one tick, and can never
  reach zero.

Two settings if you want it livelier or calmer (set them in the shell or in
`.env`):

    GENERATOR_INTERVAL_MS=3000     time between cycles
    GENERATOR_VOLATILITY=0.002     size of the random move per tick

## Opening price, high and low

The first cycle of each trading day (in market time) resets the opening price to
that stock's current price and sets the high and low to match. After that the
high and low only widen. Whether a stock is on a new day is worked out from its
`updated_at`, so restarting the generator in the middle of the day does not
reset anything.

The first time you run it against an older database, expect the opening prices
to change once, to whatever the current price is.

## One at a time

It takes a database lock when it starts. If a second generator is started
against the same database it prints a message and exits, so prices never get
moved twice.

## One cycle only

    npm run once

Runs a single cycle and exits. Useful for testing, or for running on a schedule
in AWS (the November plan is either this on an EventBridge schedule or
`npm start` as a service on the EC2 instance; neither is set up yet).

## Tests

    npm test

Checks the price movement on its own (no database needed): prices never hit
zero, stay in whole cents, never jump more than 5% in a tick, and drift back
toward the initial price.
