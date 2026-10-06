"use strict";

// Checks for the price movement. No database needed: npm test

const assert = require("node:assert");
const { createModel } = require("./priceModel");

// small seeded random number generator so the checks are repeatable
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 1. A price never reaches zero or goes negative, even for a cheap stock with
//    wild volatility.
{
  const m = createModel({ rng: seeded(1), volatility: 0.05 });
  let price = 0.05;
  for (let i = 0; i < 200000; i++) {
    price = m.nextPrice("CHEAP", price, 0.05);
    assert.ok(price >= 0.01, `price fell below a cent: ${price}`);
  }
}

// 2. Prices are whole cents and never move more than 5% in one tick.
{
  const m = createModel({ rng: seeded(2) });
  let price = 100;
  for (let i = 0; i < 50000; i++) {
    const next = m.nextPrice("ACME", price, 100);
    assert.ok(Math.abs(next * 100 - Math.round(next * 100)) < 1e-6, `not whole cents: ${next}`);
    assert.ok(Math.abs(next / price - 1) <= 0.05 + 0.0051, `moved too far: ${price} -> ${next}`);
    price = next;
  }
}

// 3. A price pushed far from its initial price drifts back toward it.
{
  const m = createModel({ rng: seeded(3) });
  let price = 200;
  for (let i = 0; i < 3000; i++) price = m.nextPrice("HIGH", price, 100);
  assert.ok(price < 150, `price did not come back toward its anchor: ${price}`);
}

// 4. Over a few hundred ticks a stock actually moves (it is not stuck).
{
  const m = createModel({ rng: seeded(4) });
  let price = 45;
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    price = m.nextPrice("ACME", price, 45);
    seen.add(price);
  }
  assert.ok(seen.size > 20, `price barely moved: ${seen.size} distinct values`);
}

console.log("All price model checks passed.");
