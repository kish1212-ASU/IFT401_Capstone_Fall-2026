const express = require("express");
const { requireAuth } = require("./auth");
const { isMarketOpen } = require("./market");
const {
  getActiveStock,
  createOrder,
  getOrderForUser,
  listOrders,
  cancelOrder
} = require("./orders");

const router = express.Router();

// How long an order stays pending, so the customer has time to cancel it.
const ORDER_DELAY_SECONDS = Number(process.env.ORDER_DELAY_SECONDS) || 8;

const STATUSES = ["pending", "executed", "canceled", "rejected"];
const MAX_INT = 2147483647;
const MAX_QUANTITY = 1000000;

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_INT ? id : null;
}

router.post("/", requireAuth, async (req, res) => {
  const { stock_id, order_type, quantity } = req.body || {};

  if (!Number.isInteger(stock_id) || stock_id < 1 || stock_id > MAX_INT) {
    return res.status(400).json({
      error: "stock_id must be a positive integer"
    });
  }

  if (order_type !== "buy" && order_type !== "sell") {
    return res.status(400).json({
      error: "order_type must be buy or sell"
    });
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return res.status(400).json({
      error: "quantity must be a positive whole number (up to " + MAX_QUANTITY + ")"
    });
  }

  try {
    const stock = await getActiveStock(stock_id);

    if (!stock) {
      return res.status(404).json({
        error: "Stock not found"
      });
    }

    // Only the market-hours check happens now. Funds and shares are checked
    // when the order executes, not when it is placed.
    if (!(await isMarketOpen())) {
      return res.status(409).json({
        error: "The market is closed"
      });
    }

    const order = await createOrder({
      user_id: req.user.user_id,
      stock_id,
      order_type,
      quantity,
      delay_seconds: ORDER_DELAY_SECONDS
    });

    if (!order) {
      return res.status(404).json({
        error: "Stock not found"
      });
    }

    res.status(201).json(order);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to place order"
    });
  }
});

router.get("/", requireAuth, async (req, res) => {
  const { status } = req.query;

  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({
      error: "status must be one of: " + STATUSES.join(", ")
    });
  }

  try {
    res.json(await listOrders(req.user.user_id, status));
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to retrieve orders"
    });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);

  if (id === null) {
    return res.status(404).json({
      error: "Order not found"
    });
  }

  try {
    const { outcome, order } = await getOrderForUser(id, req.user.user_id);

    if (outcome === "not_found") {
      return res.status(404).json({ error: "Order not found" });
    }

    if (outcome === "forbidden") {
      return res.status(403).json({ error: "That order belongs to someone else" });
    }

    res.json(order);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to retrieve order"
    });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);

  if (id === null) {
    return res.status(404).json({
      error: "Order not found"
    });
  }

  try {
    const { outcome, order } = await cancelOrder(id, req.user.user_id);

    if (outcome === "not_found") {
      return res.status(404).json({ error: "Order not found" });
    }

    if (outcome === "forbidden") {
      return res.status(403).json({ error: "That order belongs to someone else" });
    }

    if (outcome === "conflict") {
      return res.status(409).json({
        error: "Only a pending order can be canceled"
      });
    }

    res.json(order);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to cancel order"
    });
  }
});

module.exports = { ordersRouter: router };
