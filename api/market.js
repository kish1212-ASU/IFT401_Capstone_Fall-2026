const pool = require("./db");

// One place that knows whether the market is open, so GET /market, order
// placement, the order executor and the price generator all agree.
//
// Open means: the local time in the market's time zone is between the open and
// close time, today is a trading weekday, and today is not a holiday.
// is_open_override (TRUE or FALSE) beats the schedule; NULL follows it.
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
    left(market_open::text, 5)  AS market_open,
    left(market_close::text, 5) AS market_close,
    timezone,
    string_to_array(trading_days, ',')::int[] AS trading_days,
    ARRAY(SELECT to_char(h, 'YYYY-MM-DD') FROM unnest(holidays) AS h ORDER BY h) AS holidays,
    NOW() AS server_time
  FROM market_config
  WHERE config_id = 1`;

// db is the pool by default, or a transaction client.
async function getMarket(db = pool) {
  const result = await db.query(MARKET_SQL);
  return result.rows[0] || null;
}

async function isMarketOpen(db = pool) {
  const market = await getMarket(db);
  return market ? market.is_open === true : false;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(text) {
  if (!DATE_RE.test(text)) return false;
  const d = new Date(text + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

// Checks a PUT /market body and merges it with the current settings, so a
// request can send only the fields it wants to change. Returns { error } or
// { values }.
async function validateMarketUpdate(body, current) {
  const fields = ["market_open", "market_close", "timezone", "trading_days", "holidays"];
  if (!body || !fields.some((f) => body[f] !== undefined)) {
    return { error: "Send at least one of: " + fields.join(", ") };
  }

  const values = {
    market_open: body.market_open !== undefined ? body.market_open : current.market_open,
    market_close: body.market_close !== undefined ? body.market_close : current.market_close,
    timezone: body.timezone !== undefined ? body.timezone : current.timezone,
    trading_days: body.trading_days !== undefined ? body.trading_days : current.trading_days,
    holidays: body.holidays !== undefined ? body.holidays : current.holidays
  };

  if (typeof values.market_open !== "string" || !TIME_RE.test(values.market_open)) {
    return { error: "market_open must be a time like 09:30 (24-hour HH:MM)" };
  }
  if (typeof values.market_close !== "string" || !TIME_RE.test(values.market_close)) {
    return { error: "market_close must be a time like 16:00 (24-hour HH:MM)" };
  }
  if (values.market_close <= values.market_open) {
    return { error: "market_close must be later than market_open" };
  }

  if (typeof values.timezone !== "string" || values.timezone.length === 0) {
    return { error: "timezone must be a time zone name like America/New_York" };
  }
  const tz = await pool.query("SELECT 1 FROM pg_timezone_names WHERE name = $1", [values.timezone]);
  if (tz.rowCount === 0) {
    return { error: "timezone is not a recognized time zone name" };
  }

  const days = values.trading_days;
  if (
    !Array.isArray(days) ||
    days.length === 0 ||
    !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 5) ||
    new Set(days).size !== days.length
  ) {
    return {
      error: "trading_days must be a list of weekday numbers 1 to 5 (1 = Monday); the market only trades on weekdays"
    };
  }
  values.trading_days = [...days].sort((a, b) => a - b);

  const holidays = values.holidays;
  if (
    !Array.isArray(holidays) ||
    !holidays.every((h) => typeof h === "string" && isRealDate(h)) ||
    new Set(holidays).size !== holidays.length
  ) {
    return { error: "holidays must be a list of unique dates like 2026-11-26" };
  }
  values.holidays = [...holidays].sort();

  return { values };
}

async function saveMarket(values) {
  await pool.query(
    `UPDATE market_config
     SET market_open = $1,
         market_close = $2,
         timezone = $3,
         trading_days = $4,
         holidays = $5::date[],
         updated_at = NOW()
     WHERE config_id = 1`,
    [
      values.market_open,
      values.market_close,
      values.timezone,
      values.trading_days.join(","),
      values.holidays
    ]
  );

  return getMarket();
}

module.exports = {
  getMarket,
  isMarketOpen,
  validateMarketUpdate,
  saveMarket
};
