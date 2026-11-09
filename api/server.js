const express = require("express");
const cors = require("cors");
const pool = require("./db");
const bcrypt = require("bcryptjs");

const {
  getAllStocks,
  createStock
} = require("./stocks");

const {
  createUser,
  getUserByUsername,
  getUserById
} = require("./users");

const {
  createToken,
  requireAuth,
  requireAdmin
} = require("./auth");

const {
  marketRouter
} = require("./marketRoutes");

const {
  ordersRouter
} = require("./orderRoutes");

const {
  cashRouter
} = require("./cashRoutes");

const {
  portfolioRouter
} = require("./portfolioRoutes");

const {
  startExecutor
} = require("./executor");

const app = express();


// --------------------------------------------------
// CORS / JSON
// --------------------------------------------------

// Locally ALLOWED_ORIGIN is unset, so CORS is
// permissive for development.
//
// In deployment, ALLOWED_ORIGIN should contain
// the real frontend domain.
const corsOptions = process.env.ALLOWED_ORIGIN
  ? {
      origin: process.env.ALLOWED_ORIGIN,
      credentials: true
    }
  : {};

app.use(cors(corsOptions));
app.use(express.json());


// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected"
    });
  } catch (err) {
    console.error(err);

    res.status(503).json({
      status: "error",
      database: "unreachable"
    });
  }
});


// --------------------------------------------------
// STOCKS
// --------------------------------------------------

app.get("/stocks", async (req, res) => {
  try {
    const stocks = await getAllStocks();

    res.json(stocks);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to retrieve stocks"
    });
  }
});

app.post(
  "/stocks",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const {
      ticker,
      company_name,
      initial_price,
      volume
    } = req.body;

    if (
      !ticker ||
      !company_name ||
      initial_price === undefined ||
      volume === undefined
    ) {
      return res.status(400).json({
        error:
          "ticker, company_name, initial_price, and volume are required"
      });
    }

    const price = Number(initial_price);
    const stockVolume = Number(volume);

    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isInteger(stockVolume) ||
      stockVolume < 0
    ) {
      return res.status(400).json({
        error: "Invalid stock data"
      });
    }

    try {
      const stock = await createStock({
        ticker,
        company_name,
        initial_price: price.toFixed(2),
        volume: stockVolume
      });

      res.status(201).json(stock);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({
          error: "Ticker already exists"
        });
      }

      console.error(err);

      res.status(500).json({
        error: "Failed to create stock"
      });
    }
  }
);


// --------------------------------------------------
// USERS
// --------------------------------------------------

app.post("/users", async (req, res) => {
  const {
    username,
    email,
    full_name,
    password
  } = req.body;

  if (
    !username ||
    !email ||
    !full_name ||
    !password
  ) {
    return res.status(400).json({
      error:
        "username, email, full_name, and password are required"
    });
  }

  try {
    const password_hash =
      await bcrypt.hash(password, 12);

    const user = await createUser({
      username,
      email,
      full_name,
      password_hash
    });

    res.status(201).json(user);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Username or email already exists"
      });
    }

    console.error(err);

    res.status(500).json({
      error: "Failed to create user"
    });
  }
});


// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

app.post(
  "/auth/login",
  async (req, res) => {
    const {
      username,
      password
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error:
          "username and password are required"
      });
    }

    try {
      const user =
        await getUserByUsername(username);

      if (!user) {
        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }

      const passwordMatches =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!passwordMatches) {
        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }

      const token =
        createToken(user);

      res.json({
        token,
        user_id: user.user_id,
        username: user.username,
        role: user.role
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Failed to log in"
      });
    }
  }
);

app.post(
  "/auth/logout",
  requireAuth,
  (req, res) => {
    // JWT authentication is stateless.
    // The frontend logs out by deleting
    // its locally stored token.
    res.status(204).send();
  }
);


// --------------------------------------------------
// CURRENT USER
// --------------------------------------------------

app.get(
  "/users/me",
  requireAuth,
  async (req, res) => {
    try {
      const user =
        await getUserById(
          req.user.user_id
        );

      if (!user) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      res.json(user);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Failed to retrieve user"
      });
    }
  }
);


// --------------------------------------------------
// ROUTERS
// --------------------------------------------------

app.use("/market", marketRouter);

app.use("/orders", ordersRouter);

app.use("/cash", cashRouter);

// portfolioRoutes contains:
// GET /portfolio
// GET /transactions
app.use("/", portfolioRouter);


// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    "API listening on " + PORT
  );

  startExecutor();
});