const express = require("express");
const { requireAuth, requireAdmin } = require("./auth");
const { getMarket, validateMarketUpdate, saveMarket } = require("./market");

const router = express.Router();

// Anyone can see whether the market is open and its hours.
router.get("/", async (req, res) => {
  try {
    const market = await getMarket();

    if (!market) {
      return res.status(500).json({
        error: "Market settings are missing"
      });
    }

    res.json(market);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to retrieve market status"
    });
  }
});

// Admin only. Send any of market_open, market_close, timezone, trading_days,
// holidays; fields left out keep their current value.
router.put("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const current = await getMarket();

    if (!current) {
      return res.status(500).json({
        error: "Market settings are missing"
      });
    }

    const { error, values } = await validateMarketUpdate(req.body, current);

    if (error) {
      return res.status(400).json({ error });
    }

    res.json(await saveMarket(values));
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to update market settings"
    });
  }
});

module.exports = { marketRouter: router };
