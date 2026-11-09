const express = require("express");

const {
  requireAuth
} = require("./auth");

const {
  getPortfolio,
  getTransactions
} = require("./portfolio");

const router = express.Router();

router.get(
  "/portfolio",
  requireAuth,
  async (req, res) => {
    try {
      const portfolio = await getPortfolio(
        req.user.user_id
      );

      if (!portfolio) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      res.json(portfolio);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Failed to retrieve portfolio"
      });
    }
  }
);

router.get(
  "/transactions",
  requireAuth,
  async (req, res) => {
    try {
      const transactions =
        await getTransactions(
          req.user.user_id
        );

      res.json(transactions);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Failed to retrieve transactions"
      });
    }
  }
);

module.exports = {
  portfolioRouter: router
};