const pool = require("./db");

// Every order response has this shape (see docs/api-contract.md).
// total_amount is worked out from the price the order actually filled at, so it
// is null until the order executes.
const ORDER_SELECT = `
  SELECT o.order_id,
         o.stock_id,
         s.ticker,
         o.order_type,
         o.quantity,
         o.status,
         o.executes_at,
         o.executed_price,
         ROUND(o.executed_price * o.quantity, 2) AS total_amount,
         o.reject_reason,
         o.created_at,
         o.executed_at,
         o.canceled_at
  FROM orders o
  JOIN stocks s ON s.stock_id = o.stock_id`;

async function getActiveStock(stock_id) {
  const result = await pool.query(
    `SELECT stock_id, ticker, current_price
     FROM stocks
     WHERE stock_id = $1 AND is_active = TRUE`,
    [stock_id]
  );

  return result.rows[0] || null;
}

// Saves a pending order. The price is NOT taken from the client and is not
// fixed here: the executor reads the stock's price when the order fills.
// requested_price only records the price at the moment of the request.
async function createOrder({ user_id, stock_id, order_type, quantity, delay_seconds }) {
  const inserted = await pool.query(
    `INSERT INTO orders
       (user_id, stock_id, order_type, quantity, requested_price, executes_at)
     SELECT $1, s.stock_id, $3, $4, s.current_price,
            NOW() + make_interval(secs => $5::double precision)
     FROM stocks s
     WHERE s.stock_id = $2 AND s.is_active = TRUE
     RETURNING order_id`,
    [user_id, stock_id, order_type, quantity, delay_seconds]
  );

  if (inserted.rowCount === 0) {
    return null;
  }

  return getOrderById(inserted.rows[0].order_id);
}

async function getOrderById(order_id) {
  const result = await pool.query(
    `${ORDER_SELECT} WHERE o.order_id = $1`,
    [order_id]
  );

  return result.rows[0] || null;
}

// One order for its owner. Someone else's order is "forbidden", not "not found",
// to match the contract.
async function getOrderForUser(order_id, user_id) {
  const owner = await pool.query(
    "SELECT user_id FROM orders WHERE order_id = $1",
    [order_id]
  );

  if (owner.rowCount === 0) {
    return { outcome: "not_found" };
  }

  if (owner.rows[0].user_id !== user_id) {
    return { outcome: "forbidden" };
  }

  return { outcome: "ok", order: await getOrderById(order_id) };
}

async function listOrders(user_id, status) {
  const params = [user_id];
  let where = "WHERE o.user_id = $1";

  if (status) {
    params.push(status);
    where += " AND o.status = $2";
  }

  const result = await pool.query(
    `${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.order_id DESC`,
    params
  );

  return result.rows;
}

// Cancels an order only while it is still pending. The status check is part of
// the UPDATE itself, so if the executor fills the order first, this changes
// nothing and the caller gets a conflict. The two can never both win.
async function cancelOrder(order_id, user_id) {
  const found = await pool.query(
    "SELECT user_id FROM orders WHERE order_id = $1",
    [order_id]
  );

  if (found.rowCount === 0) {
    return { outcome: "not_found" };
  }

  if (found.rows[0].user_id !== user_id) {
    return { outcome: "forbidden" };
  }

  const updated = await pool.query(
    `UPDATE orders
     SET status = 'canceled', canceled_at = NOW()
     WHERE order_id = $1 AND status = 'pending'
     RETURNING order_id, status, canceled_at`,
    [order_id]
  );

  if (updated.rowCount === 0) {
    return { outcome: "conflict" };
  }

  return { outcome: "canceled", order: updated.rows[0] };
}

module.exports = {
  getActiveStock,
  createOrder,
  getOrderById,
  getOrderForUser,
  listOrders,
  cancelOrder
};
