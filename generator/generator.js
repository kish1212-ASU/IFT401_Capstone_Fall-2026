"use strict";

// Random Stock Price Generator
//
// A background job, not an HTTP route. It talks to the database directly (see
// the generator notes in docs/api-contract.md). Every few seconds it checks
// whether the market is open and, if so, nudges the price of every active stock
// up or down by a small amount and keeps the day's open, high and low current.
//
//   npm start         run until stopped (Ctrl+C)
//   npm run once      run a single cycle and exit (for a scheduled job)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");
const { createModel } = require("./priceModel");

const TICK_MS = Number(process.env.GENERATOR_INTERVAL_MS) || 3000;
const VOLATILITY = Number(process.env.GENERATOR_VOLATILITY) || 0.002;
const ONCE = process.argv.includes("--once");
const LOCK_KEY = 401401; // so two generators can never move the same prices

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const model = createModel({ volatility: VOLATILITY });

// Is the market open right now? Same rules as GET /market: open and close time
// in the market's own time zone, a trading weekday, not a holiday. If
// is_open_override is TRUE or FALSE it wins over the schedule.
const MARKET_SQL = `
  SELECT
    COALESCE(
      is_open_override,
      (
        EXTRACT(ISODOW FROM (NOW() AT TIME ZONE timezone))::int
            = ANY (string_to_array(trading_days, ',')::int[])
        AND (NOW() AT TIME ZONE timezone)::time >= market_open
        AND (NOW() AT TIME ZONE timezone)::time <  market_close
        AND NOT ((NOW() AT TIME ZONE timezone)::date = ANY (holidays))
      )
    ) AS is_open,
    is_open_override IS NOT NULL AS overridden,
    to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD HH24:MI') AS local_time
  FROM market_config
  WHERE config_id = 1`;

// new_session is true for the first cycle of a trading day: the stock has not
// been touched yet today (in market time). That is when the open, high and low
// reset. It is worked out from updated_at, so restarting the generator in the
// middle of the day does not reset anything.
const STOCKS_SQL = `
  SELECT s.stock_id, s.ticker, s.initial_price, s.current_price,
         s.opening_price, s.day_high, s.day_low,
         ((s.updated_at AT TIME ZONE m.timezone)::date
            < (NOW() AT TIME ZONE m.timezone)::date) AS new_session
  FROM stocks s
  CROSS JOIN market_config m
  WHERE s.is_active AND m.config_id = 1
  ORDER BY s.stock_id
  FOR UPDATE OF s`;

const UPDATE_SQL = `
  UPDATE stocks
  SET current_price = $2, opening_price = $3, day_high = $4, day_low = $5,
      updated_at = NOW()
  WHERE stock_id = $1`;

let lastState = null;
let lockClient = null;
let stopping = false;

function stamp() {
  return new Date().toLocaleTimeString();
}

function noteState(open, message) {
  if (lastState !== open) {
    console.log(`[${stamp()}] ${message}`);
    lastState = open;
  }
}

async function runCycle() {
  const { rows: marketRows } = await pool.query(MARKET_SQL);
  if (marketRows.length === 0) {
    console.error("market_config has no row with config_id = 1. Nothing to do.");
    return;
  }
  const market = marketRows[0];

  if (!market.is_open) {
    noteState(false, `Market closed (${market.local_time} market time). Waiting.`);
    return;
  }
  noteState(
    true,
    market.overridden
      ? "Market is open (forced by is_open_override). Moving prices."
      : "Market is open. Moving prices."
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(STOCKS_SQL);
    const moves = [];

    for (const r of rows) {
      const price = Number(r.current_price);
      const anchor = Number(r.initial_price);

      let open = Number(r.opening_price);
      let high = Number(r.day_high);
      let low = Number(r.day_low);
      const missing = r.opening_price === null || r.day_high === null || r.day_low === null;
      if (r.new_session || missing) {
        open = price;
        high = price;
        low = price;
      }

      const next = model.nextPrice(r.stock_id, price, anchor);
      high = Math.max(high, next);
      low = Math.min(low, next);

      await client.query(UPDATE_SQL, [
        r.stock_id,
        next.toFixed(2),
        open.toFixed(2),
        high.toFixed(2),
        low.toFixed(2),
      ]);

      const diff = next - price;
      moves.push(`${r.ticker} ${next.toFixed(2)} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)})`);
    }

    await client.query("COMMIT");
    console.log(`[${stamp()}] ${moves.join("  ")}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function acquireLock() {
  lockClient = await pool.connect();
  const { rows } = await lockClient.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
  return rows[0].ok;
}

async function shutdown(code) {
  stopping = true;
  try {
    if (lockClient) {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
      lockClient.release();
    }
    await pool.end();
  } finally {
    process.exit(code);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let locked;
  try {
    locked = await acquireLock();
  } catch (err) {
    console.error(`Could not reach the database: ${err.message}`);
    console.error("Is it running? Try: docker compose up -d");
    process.exit(1);
  }
  if (!locked) {
    console.log("Another price generator is already running against this database. Exiting.");
    await shutdown(ONCE ? 0 : 1);
    return;
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  if (ONCE) {
    try {
      await runCycle();
      await shutdown(0);
    } catch (err) {
      console.error(`Cycle failed: ${err.message}`);
      await shutdown(1);
    }
    return;
  }

  console.log(`Price generator started. One cycle every ${TICK_MS / 1000}s. Ctrl+C to stop.`);
  while (!stopping) {
    try {
      await runCycle();
    } catch (err) {
      console.error(`[${stamp()}] Cycle failed, will retry: ${err.message}`);
    }
    await sleep(TICK_MS);
  }
}

main();
