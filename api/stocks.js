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

module.exports = { getAllStocks };
