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

async function getUserByUsername(username) {
  const result = await pool.query(
    `SELECT
       user_id,
       username,
       email,
       full_name,
       password_hash,
       role,
       cash_balance,
       created_at
     FROM users
     WHERE username = $1`,
    [username]
  );

  return result.rows[0] || null;
}

async function getUserById(user_id) {
  const result = await pool.query(
    `SELECT
       user_id,
       username,
       email,
       full_name,
       role,
       cash_balance,
       created_at
     FROM users
     WHERE user_id = $1`,
    [user_id]
  );

  return result.rows[0] || null;
}

module.exports = {
  createUser,
  getUserByUsername,
  getUserById
};