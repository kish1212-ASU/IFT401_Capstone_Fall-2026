const express = require("express");
const { requireAuth } = require("./auth");
const {
  depositCash,
  withdrawCash
} = require("./cash");

const router = express.Router();

function parseAmount(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    !/^\d+(\.\d{1,2})?$/.test(String(value))
  ) {
    return null;
  }

  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount.toFixed(2);
}

router.post("/deposit", requireAuth, async (req, res) => {
  const amount = parseAmount(req.body?.amount);

  if (amount === null) {
    return res.status(400).json({
      error: "amount must be greater than zero"
    });
  }

  try {
    const transaction = await depositCash(
      req.user.user_id,
      amount
    );

    if (!transaction) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    res.status(201).json(transaction);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to deposit cash"
    });
  }
});

router.post("/withdraw", requireAuth, async (req, res) => {
  const amount = parseAmount(req.body?.amount);

  if (amount === null) {
    return res.status(400).json({
      error: "amount must be greater than zero"
    });
  }

  try {
    const result = await withdrawCash(
      req.user.user_id,
      amount
    );

    if (result.outcome === "not_found") {
      return res.status(404).json({
        error: "User not found"
      });
    }

    if (result.outcome === "insufficient_funds") {
      return res.status(409).json({
        error: "Insufficient funds"
      });
    }

    res.status(201).json(result.transaction);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to withdraw cash"
    });
  }
});

module.exports = {
  cashRouter: router
};