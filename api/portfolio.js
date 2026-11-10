const pool = require("./db");

async function getPortfolio(user_id) {
  const client = await pool.connect();

  try {
    // Get the user's current cash balance.
    const userResult = await client.query(
      `SELECT cash_balance
       FROM users
       WHERE user_id = $1`,
      [user_id]
    );

    if (userResult.rowCount === 0) {
      return null;
    }

    const cashBalance = userResult.rows[0].cash_balance;

    // Get current holdings using the stock's LIVE current price.
    // Zero-quantity holdings are excluded.
    const holdingsResult = await client.query(
      `SELECT
         h.stock_id,
         s.ticker,
         s.company_name,
         h.quantity,
         h.avg_cost_basis,
         s.current_price,
         ROUND(
           (h.quantity * s.current_price)::numeric,
           2
         ) AS market_value,
         ROUND(
           (
             h.quantity *
             (s.current_price - h.avg_cost_basis)
           )::numeric,
           2
         ) AS gain_loss
       FROM holdings h
       JOIN stocks s
         ON s.stock_id = h.stock_id
       WHERE h.user_id = $1
         AND h.quantity > 0
       ORDER BY s.ticker`,
      [user_id]
    );

    // Calculate the total current value of all holdings in Postgres
    // so we do not rely on JavaScript floating-point math.
    const holdingsValueResult = await client.query(
      `SELECT
         COALESCE(
           ROUND(
             SUM(h.quantity * s.current_price)::numeric,
             2
           ),
           0.00
         ) AS holdings_value
       FROM holdings h
       JOIN stocks s
         ON s.stock_id = h.stock_id
       WHERE h.user_id = $1
         AND h.quantity > 0`,
      [user_id]
    );

    const holdingsValue =
      holdingsValueResult.rows[0].holdings_value;

    // Calculate total portfolio value:
    // cash balance + current holdings value.
    const totalResult = await client.query(
      `SELECT
         ROUND(
           ($1::numeric + $2::numeric),
           2
         ) AS total_value`,
      [cashBalance, holdingsValue]
    );

    return {
      cash_balance: cashBalance,
      holdings_value: holdingsValue,
      total_value: totalResult.rows[0].total_value,
      holdings: holdingsResult.rows
    };
  } finally {
    client.release();
  }
}

async function getTransactions(user_id) {
  const result = await pool.query(
    `SELECT
       t.transaction_id,
       t.transaction_type,
       s.ticker,
       t.quantity,
       t.price_per_share,
       t.total_amount,
       t.balance_after,
       t.created_at
     FROM transactions t
     LEFT JOIN stocks s
       ON s.stock_id = t.stock_id
     WHERE t.user_id = $1
     ORDER BY t.created_at DESC,
              t.transaction_id DESC`,
    [user_id]
  );

  return result.rows;
}

module.exports = {
  getPortfolio,
  getTransactions
};