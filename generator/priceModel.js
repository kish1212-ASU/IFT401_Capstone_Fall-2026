"use strict";

// The price movement itself, kept separate from the database code so it can be
// tested on its own.
//
// Each tick is a small random move (about 0.2% by default) plus a slow drift
// that holds for a few dozen ticks, so a stock trends up or down for a while
// instead of jittering around one number. A gentle pull back toward the stock's
// initial price keeps it from wandering off over several days. Prices are
// rounded to cents and can never reach zero.

function createModel(opts = {}) {
  const {
    volatility = 0.002,        // standard deviation of the random move per tick
    driftScale = 0.0006,       // largest drift per tick (0.06%)
    driftTicks = [20, 60],     // how many ticks a drift lasts
    reversion = 0.01,          // share of the gap to the anchor closed per tick
    maxMove = 0.05,            // hard cap on a single tick (5%)
    minPrice = 0.01,
    rng = Math.random,
  } = opts;

  const state = new Map();

  function gaussian() {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  function currentDrift(key) {
    let s = state.get(key);
    if (!s || s.ticksLeft <= 0) {
      const [lo, hi] = driftTicks;
      s = {
        drift: (rng() * 2 - 1) * driftScale,
        ticksLeft: lo + Math.floor(rng() * (hi - lo + 1)),
      };
      state.set(key, s);
    }
    s.ticksLeft -= 1;
    return s.drift;
  }

  // key identifies the stock (so each one keeps its own drift), anchor is the
  // price it gravitates toward.
  function nextPrice(key, price, anchor) {
    const pull = anchor > 0 ? reversion * ((anchor - price) / anchor) : 0;
    let pct = currentDrift(key) + gaussian() * volatility + pull;
    pct = Math.max(-maxMove, Math.min(maxMove, pct));
    return Math.max(minPrice, round2(price * (1 + pct)));
  }

  return { nextPrice };
}

module.exports = { createModel };
