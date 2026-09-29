const pool = require("./db");

async function createUser({ username, email, full_name, password_hash }) {
  const result = await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING
       user_id,
       username,
       email,
       full_name,
       role,
       cash_balance,
       created_at`,
    [username, email, full_name, password_hash]
  );

  return result.rows[0];
}

module.exports = {
  createUser
};