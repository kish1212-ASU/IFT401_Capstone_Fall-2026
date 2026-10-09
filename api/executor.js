const pool = require("./db");
const { isMarketOpen } = require("./market");

// The order executor. A timer inside the API that fills pending orders whose
// executes_at has passed (see docs/api-contract.md, "Order executor").
//
// Each order is settled in its own database transaction:
//   1. lock the order row (FOR UPDATE SKIP LOCKED) so two runs never fill the
//      same order and a cancel in progress is never overridden
//   2. re-check that the market is open
//   3. read the stock's price right now
//   4. buy: take the cash, add shares. sell: take the shares, add the cash
//   5. write the transaction row and mark the order executed
// If a check fails the order is marked rejected with a reason instead.
// Money math is done by the database (NUMERIC), never with JavaScript floats.

const INTERVAL_MS = Number(process.env.EXECUTOR_INTERVAL_MS) || 1000;
const BATCH_SIZE = 50;

let timer = null;
let running = false;

async function findDueOrderIds() {
  const result = await pool.query(
    `SELECT order_id
     FROM orders
     WHERE status = 'pending' AND executes_at <= NOW()
     ORDER BY executes_at, order_id
     LIMIT $1`,
    [BATCH_SIZE]
  );

  return result.rows.map((r) => r.order_id);
}

async function reject(client, order, reason) {
  await client.query(
    `UPDATE orders SET status = 'rejected', reject_reason = $2 WHERE order_id = $1`,
    [order.order_id, reason]
  );

  return { status: "rejected", reason };
}

async function settle(client, order) {
  if (!(await isMarketOpen(client))) {
    return reject(client, order, "market closed");
  }

  const stockResult = await client.query(
    "SELECT current_price, is_active FROM stocks WHERE stock_id = $1",
    [order.stock_id]
  );
  const stock = stockResult.rows[0];

  if (!stock || !stock.is_active) {
    return reject(client, order, "stock unavailable");
  }

  const price = stock.current_price;
  const totalResult = await client.query(
    "SELECT ROUND($1::numeric * $2::int, 2) AS total",
    [price, order.quantity]
  );
  const total = totalResult.rows[0].total;

  // Orders from the same user are settled one at a time.
  await client.query("SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE", [order.user_id]);

  let balanceAfter;

  if (order.order_type === "buy") {
    // The balance check and the withdrawal are one statement, so they cannot
    // disagree.
    const paid = await client.query(
      `UPDATE users
       SET cash_balance = cash_balance - $2
       WHERE user_id = $1 AND cash_balance >= $2
       RETURNING cash_balance`,
      [order.user_id, total]
    );

    if (paid.rowCount === 0) {
      return reject(client, order, "insufficient funds");
    }

    balanceAfter = paid.rows[0].cash_balance;

    // New average cost = (old shares x old average + new shares x price) / all shares.
    await client.query(
      `INSERT INTO holdings (user_id, stock_id, quantity, avg_cost_basis)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, stock_id) DO UPDATE SET
         avg_cost_basis = ((holdings.quantity * holdings.avg_cost_basis)
                           + (EXCLUDED.quantity * EXCLUDED.avg_cost_basis))
                          / (holdings.quantity + EXCLUDED.quantity),
         quantity = holdings.quantity + EXCLUDED.quantity,
         updated_at = NOW()`,
      [order.user_id, order.stock_id, order.quantity, price]
    );
  } else {
    const sold = await client.query(
      `UPDATE holdings
       SET quantity = quantity - $3, updated_at = NOW()
       WHERE user_id = $1 AND stock_id = $2 AND quantity >= $3
       RETURNING quantity`,
      [order.user_id, order.stock_id, order.quantity]
    );

    if (sold.rowCount === 0) {
      return reject(client, order, "insufficient shares");
    }

    const credited = await client.query(
      `UPDATE users
       SET cash_balance = cash_balance + $2
       WHERE user_id = $1
       RETURNING cash_balance`,
      [order.user_id, total]
    );

    balanceAfter = credited.rows[0].cash_balance;
  }

  await client.query(
    `INSERT INTO transactions
       (user_id, stock_id, order_id, transaction_type,
        quantity, price_per_share, total_amount, balance_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      order.user_id,
      order.stock_id,
      order.order_id,
      order.order_type,
      order.quantity,
      price,
      total,
      balanceAfter
    ]
  );

  await client.query(
    `UPDATE orders
     SET status = 'executed', executed_price = $2, executed_at = NOW()
     WHERE order_id = $1`,
    [order.order_id, price]
  );

  return { status: "executed", price, total };
}

async function executeOrder(order_id) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // SKIP LOCKED: if a cancel (or another run) holds this row, leave it. If a
    // cancel already won, the status is no longer pending and nothing is found.
    const locked = await client.query(
      `SELECT order_id, user_id, stock_id, order_type, quantity
       FROM orders
       WHERE order_id = $1 AND status = 'pending' AND executes_at <= NOW()
       FOR UPDATE SKIP LOCKED`,
      [order_id]
    );

    if (locked.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const order = locked.rows[0];
    const outcome = await settle(client, order);

    await client.query("COMMIT");

    return { order, outcome };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// If an order keeps failing for a reason other than the checks above, stop it
// being retried every second forever.
async function markSystemError(order_id) {
  try {
    await pool.query(
      `UPDATE orders
       SET status = 'rejected', reject_reason = 'system error'
       WHERE order_id = $1 AND status = 'pending'`,
      [order_id]
    );
  } catch (err) {
    console.error("Could not mark order " + order_id + " as failed:", err.message);
  }
}

async function tick() {
  if (running) {
    return;
  }

  running = true;

  try {
    for (const order_id of await findDueOrderIds()) {
      try {
        const done = await executeOrder(order_id);

        if (done) {
          const { order, outcome } = done;
          const what = order.order_type + " " + order.quantity + " (stock " + order.stock_id + ")";

          if (outcome.status === "executed") {
            console.log("Order " + order_id + " executed: " + what + " at " + outcome.price + " = " + outcome.total);
          } else {
            console.log("Order " + order_id + " rejected: " + what + ": " + outcome.reason);
          }
        }
      } catch (err) {
        console.error("Order " + order_id + " failed:", err.message);
        await markSystemError(order_id);
      }
    }
  } catch (err) {
    console.error("Order executor could not check for orders:", err.message);
  } finally {
    running = false;
  }
}

function startExecutor() {
  if (timer) {
    return;
  }

  timer = setInterval(tick, INTERVAL_MS);
  console.log("Order executor running every " + INTERVAL_MS + " ms");
}

function stopExecutor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startExecutor, stopExecutor };
