const express = require("express");
const cors = require("cors");
const pool = require("./db");
const { getAllStocks } = require("./stocks");

const app = express();

// Locally ALLOWED_ORIGIN is unset, so CORS is permissive for dev.
// In a deployed environment set ALLOWED_ORIGIN to the real domain.
const corsOptions = process.env.ALLOWED_ORIGIN
  ? { origin: process.env.ALLOWED_ORIGIN, credentials: true }
  : {};
app.use(cors(corsOptions));

app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error(err);
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});

app.get("/stocks", async (req, res) => {
  try {
    res.json(await getAllStocks());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retrieve stocks" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API listening on " + PORT));