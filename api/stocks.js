const pool = require("./db");

async function getAllStocks() {
  const result = await pool.query(
    `SELECT stock_id, ticker, company_name, current_price,
            opening_price, day_high, day_low, volume,
            (volume * current_price) AS market_cap
     FROM stocks
     WHERE is_active = TRUE
     ORDER BY ticker`
  );

  return result.rows;
}

async function createStock({
  ticker,
  company_name,
  initial_price,
  volume
}) {
  const result = await pool.query(
    `INSERT INTO stocks (
       ticker,
       company_name,
       initial_price,
       current_price,
       opening_price,
       day_high,
       day_low,
       volume
     )
     VALUES ($1, $2, $3, $3, $3, $3, $3, $4)
     RETURNING
       stock_id,
       ticker,
       company_name,
       current_price,
       opening_price,
       day_high,
       day_low,
       volume,
       is_active,
       created_at,
       updated_at`,
    [
      ticker.toUpperCase(),
      company_name,
      initial_price,
      volume
    ]
  );

  return result.rows[0];
}

module.exports = {
  getAllStocks,
  createStock
};