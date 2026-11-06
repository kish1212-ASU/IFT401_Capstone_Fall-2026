const pool = require("./db");

async function depositCash(user_id, amount) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `UPDATE users
       SET cash_balance = cash_balance + $1
       WHERE user_id = $2
       RETURNING cash_balance`,
      [amount, user_id]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const balance_after = userResult.rows[0].cash_balance;

    const transactionResult = await client.query(
      `INSERT INTO transactions
         (user_id, transaction_type, total_amount, balance_after)
       VALUES ($1, 'deposit', $2, $3)
       RETURNING
         transaction_id,
         transaction_type,
         total_amount,
         balance_after,
         created_at`,
      [user_id, amount, balance_after]
    );

    await client.query("COMMIT");

    return transactionResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function withdrawCash(user_id, amount) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `UPDATE users
       SET cash_balance = cash_balance - $1
       WHERE user_id = $2
         AND cash_balance >= $1
       RETURNING cash_balance`,
      [amount, user_id]
    );

    if (userResult.rowCount === 0) {
      const exists = await client.query(
        `SELECT user_id FROM users WHERE user_id = $1`,
        [user_id]
      );

      await client.query("ROLLBACK");

      if (exists.rowCount === 0) {
        return { outcome: "not_found" };
      }

      return { outcome: "insufficient_funds" };
    }

    const balance_after = userResult.rows[0].cash_balance;

    const transactionResult = await client.query(
      `INSERT INTO transactions
         (user_id, transaction_type, total_amount, balance_after)
       VALUES ($1, 'withdrawal', $2, $3)
       RETURNING
         transaction_id,
         transaction_type,
         total_amount,
         balance_after,
         created_at`,
      [user_id, amount, balance_after]
    );

    await client.query("COMMIT");

    return {
      outcome: "ok",
      transaction: transactionResult.rows[0]
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  depositCash,
  withdrawCash
};