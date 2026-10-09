// Integration test for the market and order routes.
//
//   docker compose up -d
//   cd api
//   npm run test:integration
//
// It starts its own copy of the API on port 3199 against the database in the
// root .env, creates throwaway users (named it_<name>_<timestamp>) and removes
// them afterwards, and puts the market settings and ACME's price back as it
// found them. Don't run it while the price generator is running, because the
// generator would move ACME's price in the middle of a check.

const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const path = require("node:path");
const bcrypt = require("bcryptjs");

require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), quiet: true });
const pool = require("../db");

const PORT = 3199;
const BASE = "http://localhost:" + PORT;
const ORDER_DELAY_S = 1.5;
const stamp = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function one(sql, params) {
  return (await pool.query(sql, params)).rows[0];
}

async function waitForStatus(token, orderId, wanted, ms = 6000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await api("GET", "/orders/" + orderId, { token });
    if (wanted.includes(r.body.status)) return r.body;
    await sleep(150);
  }
  throw new Error("order " + orderId + " never reached " + wanted.join("/"));
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("  ok    " + name);
  } catch (err) {
    failed += 1;
    console.log("  FAIL  " + name + "\n        " + String(err.message).split("\n").join("\n        "));
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
    process.exit(1);
  }

  // remember what we are about to change
  const marketBefore = await one("SELECT * FROM market_config WHERE config_id = 1");
  const acme = await one("SELECT * FROM stocks WHERE ticker = 'ACME'");
  assert.ok(marketBefore && acme, "the seed data (market_config and ACME) is missing");

  const api_proc = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: "integration-test-secret",
      ORDER_DELAY_SECONDS: String(ORDER_DELAY_S),
      EXECUTOR_INTERVAL_MS: "250"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverLog = "";
  api_proc.stdout.on("data", (d) => (serverLog += d));
  api_proc.stderr.on("data", (d) => (serverLog += d));

  const setMarket = (override) =>
    pool.query("UPDATE market_config SET is_open_override = $1 WHERE config_id = 1", [override]);

  async function makeUser(name, role, cash) {
    const hash = await bcrypt.hash("Passw0rd!", 4);
    const u = `it_${name}_${stamp}`;
    const r = await one(
      `INSERT INTO users (username, email, full_name, password_hash, role, cash_balance)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id`,
      [u, u + "@example.com", "IT " + name, hash, role, cash]
    );
    return { id: r.user_id, username: u };
  }
  async function login(u) {
    const r = await api("POST", "/auth/login", { body: { username: u.username, password: "Passw0rd!" } });
    assert.equal(r.status, 200, "login failed for " + u.username);
    return r.body.token;
  }

  try {
    // wait for the API
    const until = Date.now() + 10000;
    for (;;) {
      try {
        if ((await fetch(BASE + "/health")).ok) break;
      } catch (e) { /* not up yet */ }
      if (Date.now() > until) throw new Error("API did not start:\n" + serverLog);
      await sleep(200);
    }

    const admin = await makeUser("admin", "admin", 0);
    const alice = await makeUser("alice", "customer", 10000);
    const bob = await makeUser("bob", "customer", 50);
    const carol = await makeUser("carol", "customer", 100000);
    const adminT = await login(admin);
    const aliceT = await login(alice);
    const bobT = await login(bob);
    const carolT = await login(carol);

    // ---------------------------------------------------------------- market
    console.log("\nMarket");

    await test("GET /market has the contract shape and needs no login", async () => {
      const r = await api("GET", "/market");
      assert.equal(r.status, 200);
      assert.deepEqual(
        Object.keys(r.body).sort(),
        ["holidays", "is_open", "market_close", "market_open", "server_time", "timezone", "trading_days"]
      );
      assert.equal(typeof r.body.is_open, "boolean");
      assert.match(r.body.market_open, /^\d\d:\d\d$/);
      assert.match(r.body.market_close, /^\d\d:\d\d$/);
      assert.ok(Array.isArray(r.body.trading_days) && r.body.trading_days.every(Number.isInteger));
      assert.ok(Array.isArray(r.body.holidays));
      assert.ok(!Number.isNaN(Date.parse(r.body.server_time)));
    });

    await test("PUT /market without a token is 401, as a customer is 403", async () => {
      assert.equal((await api("PUT", "/market", { body: { market_close: "17:00" } })).status, 401);
      assert.equal((await api("PUT", "/market", { token: aliceT, body: { market_close: "17:00" } })).status, 403);
    });

    await test("PUT /market rejects bad input with 400", async () => {
      const bad = [
        {},
        { market_open: "9:30" },
        { market_close: "25:00" },
        { market_open: "16:00", market_close: "09:30" },
        { market_open: "10:00", market_close: "10:00" },
        { timezone: "Mars/Base" },
        { trading_days: [1, 2, 3, 4, 5, 6] },
        { trading_days: [] },
        { trading_days: [1, 1] },
        { holidays: ["2026-02-30"] },
        { holidays: ["tomorrow"] }
      ];
      for (const body of bad) {
        const r = await api("PUT", "/market", { token: adminT, body });
        assert.equal(r.status, 400, "expected 400 for " + JSON.stringify(body) + " but got " + r.status);
        assert.ok(r.body.error);
      }
    });

    await test("PUT /market as admin saves and GET /market shows it", async () => {
      const body = {
        market_open: "09:00",
        market_close: "16:30",
        timezone: "America/New_York",
        trading_days: [5, 1, 2, 3, 4],
        holidays: ["2026-12-25", "2026-11-26"]
      };
      const put = await api("PUT", "/market", { token: adminT, body });
      assert.equal(put.status, 200);
      const get = await api("GET", "/market");
      for (const r of [put.body, get.body]) {
        assert.equal(r.market_open, "09:00");
        assert.equal(r.market_close, "16:30");
        assert.equal(r.timezone, "America/New_York");
        assert.deepEqual(r.trading_days, [1, 2, 3, 4, 5]);
        assert.deepEqual(r.holidays, ["2026-11-26", "2026-12-25"]);
      }
    });

    await test("PUT /market accepts a partial update and keeps the rest", async () => {
      const r = await api("PUT", "/market", { token: adminT, body: { market_close: "17:00" } });
      assert.equal(r.status, 200);
      assert.equal(r.body.market_close, "17:00");
      assert.equal(r.body.market_open, "09:00");
      assert.deepEqual(r.body.trading_days, [1, 2, 3, 4, 5]);
    });

    await test("is_open follows hours, holidays and the override", async () => {
      // direct writes so the check works on any day of the week
      await pool.query(
        `UPDATE market_config SET market_open = '00:00', market_close = '23:59',
           trading_days = '1,2,3,4,5,6,7', holidays = '{}', is_open_override = NULL, timezone = 'America/New_York'
         WHERE config_id = 1`
      );
      assert.equal((await api("GET", "/market")).body.is_open, true, "open all day, every day");

      await pool.query(
        "UPDATE market_config SET holidays = ARRAY[(NOW() AT TIME ZONE timezone)::date] WHERE config_id = 1"
      );
      assert.equal((await api("GET", "/market")).body.is_open, false, "today is a holiday");

      await setMarket(true);
      assert.equal((await api("GET", "/market")).body.is_open, true, "override TRUE wins over the holiday");

      await pool.query("UPDATE market_config SET holidays = '{}' WHERE config_id = 1");
      await setMarket(false);
      assert.equal((await api("GET", "/market")).body.is_open, false, "override FALSE wins over the hours");
    });

    // ---------------------------------------------------------------- orders
    console.log("\nOrders");
    await setMarket(true);
    const sid = acme.stock_id;
    const setPrice = (p) =>
      pool.query(
        "UPDATE stocks SET current_price = $1, opening_price = $1, day_high = $1, day_low = $1 WHERE stock_id = $2",
        [p, sid]
      );
    const cashOf = async (u) => (await one("SELECT cash_balance FROM users WHERE user_id = $1", [u.id])).cash_balance;
    const sharesOf = async (u) =>
      (await one("SELECT COALESCE(SUM(quantity), 0)::int AS q FROM holdings WHERE user_id = $1 AND stock_id = $2", [u.id, sid])).q;
    const place = (t, type, qty) => api("POST", "/orders", { token: t, body: { stock_id: sid, order_type: type, quantity: qty } });

    await test("orders need a login", async () => {
      assert.equal((await api("POST", "/orders", { body: { stock_id: sid, order_type: "buy", quantity: 1 } })).status, 401);
      assert.equal((await api("GET", "/orders")).status, 401);
      assert.equal((await api("DELETE", "/orders/1")).status, 401);
    });

    await test("POST /orders rejects bad input with 400", async () => {
      const bad = [
        {},
        { stock_id: "1", order_type: "buy", quantity: 1 },
        { stock_id: 0, order_type: "buy", quantity: 1 },
        { stock_id: sid, order_type: "hold", quantity: 1 },
        { stock_id: sid, order_type: "buy", quantity: 0 },
        { stock_id: sid, order_type: "buy", quantity: -3 },
        { stock_id: sid, order_type: "buy", quantity: 1.5 },
        { stock_id: sid, order_type: "buy", quantity: "5" }
      ];
      for (const body of bad) {
        const r = await api("POST", "/orders", { token: aliceT, body });
        assert.equal(r.status, 400, "expected 400 for " + JSON.stringify(body) + " but got " + r.status);
      }
    });

    await test("an unknown stock is 404 and a closed market is 409", async () => {
      const r = await api("POST", "/orders", { token: aliceT, body: { stock_id: 99999, order_type: "buy", quantity: 1 } });
      assert.equal(r.status, 404);
      await setMarket(false);
      const closed = await place(aliceT, "buy", 1);
      await setMarket(true);
      assert.equal(closed.status, 409);
    });

    let firstBuy;
    await test("a buy is saved pending, then executed at the price at that moment", async () => {
      await setPrice("100.00");
      const r = await place(aliceT, "buy", 5);
      assert.equal(r.status, 201);
      const o = r.body;
      assert.equal(o.status, "pending");
      assert.equal(o.ticker, "ACME");
      assert.equal(o.order_type, "buy");
      assert.equal(o.quantity, 5);
      assert.equal(o.executed_price, null);
      assert.equal(o.total_amount, null);
      assert.equal(o.reject_reason, null);
      assert.ok(Date.parse(o.executes_at) > Date.parse(o.created_at), "executes_at is after created_at");
      assert.equal(await cashOf(alice), "10000.00", "cash is not touched while pending");

      const list = await api("GET", "/orders?status=pending", { token: aliceT });
      assert.ok(list.body.some((x) => x.order_id === o.order_id), "shows in the pending list");

      // the price moves while the order waits; it fills at the new price
      await setPrice("110.00");
      const done = await waitForStatus(aliceT, o.order_id, ["executed", "rejected"]);
      assert.equal(done.status, "executed");
      assert.equal(done.executed_price, "110.0000");
      assert.equal(done.total_amount, "550.00");
      assert.ok(done.executed_at);
      assert.equal(await cashOf(alice), "9450.00");
      assert.equal(await sharesOf(alice), 5);

      const txn = await one("SELECT * FROM transactions WHERE order_id = $1", [o.order_id]);
      assert.equal(txn.transaction_type, "buy");
      assert.equal(txn.quantity, 5);
      assert.equal(txn.price_per_share, "110.0000");
      assert.equal(txn.total_amount, "550.00");
      assert.equal(txn.balance_after, "9450.00");
      firstBuy = done;
    });

    await test("a second buy at a new price averages the cost", async () => {
      await setPrice("120.00");
      const r = await place(aliceT, "buy", 5);
      await waitForStatus(aliceT, r.body.order_id, ["executed"]);
      const h = await one("SELECT quantity, avg_cost_basis FROM holdings WHERE user_id = $1 AND stock_id = $2", [alice.id, sid]);
      assert.equal(h.quantity, 10);
      assert.equal(h.avg_cost_basis, "115.0000"); // (5 x 110 + 5 x 120) / 10
      assert.equal(await cashOf(alice), "8850.00"); // 9450 - 5 x 120
    });

    await test("a sell pays cash and reduces the shares", async () => {
      await setPrice("130.00");
      const r = await place(aliceT, "sell", 4);
      const done = await waitForStatus(aliceT, r.body.order_id, ["executed", "rejected"]);
      assert.equal(done.status, "executed");
      assert.equal(done.total_amount, "520.00");
      assert.equal(await sharesOf(alice), 6);
      assert.equal(await cashOf(alice), "9370.00"); // 8850 + 4 x 130
      const txn = await one("SELECT * FROM transactions WHERE order_id = $1", [r.body.order_id]);
      assert.equal(txn.transaction_type, "sell");
      assert.equal(txn.balance_after, "9370.00");
    });

    await test("selling more than you own is rejected and changes nothing", async () => {
      const r = await place(aliceT, "sell", 100);
      const done = await waitForStatus(aliceT, r.body.order_id, ["executed", "rejected"]);
      assert.equal(done.status, "rejected");
      assert.equal(done.reject_reason, "insufficient shares");
      assert.equal(done.executed_price, null);
      assert.equal(await sharesOf(alice), 6);
      assert.equal(await cashOf(alice), "9370.00");
      assert.equal((await one("SELECT count(*)::int AS n FROM transactions WHERE order_id = $1", [r.body.order_id])).n, 0);
    });

    await test("buying more than your cash covers is rejected and changes nothing", async () => {
      const r = await place(bobT, "buy", 10); // 10 x 130 = 1300, bob has 50
      const done = await waitForStatus(bobT, r.body.order_id, ["executed", "rejected"]);
      assert.equal(done.status, "rejected");
      assert.equal(done.reject_reason, "insufficient funds");
      assert.equal(await cashOf(bob), "50.00");
      assert.equal(await sharesOf(bob), 0);
    });

    await test("an order is rejected if the market closes before it executes", async () => {
      const r = await place(aliceT, "buy", 1);
      assert.equal(r.status, 201);
      await setMarket(false);
      const done = await waitForStatus(aliceT, r.body.order_id, ["executed", "rejected"]);
      await setMarket(true);
      assert.equal(done.status, "rejected");
      assert.equal(done.reject_reason, "market closed");
    });

    await test("you only see your own orders", async () => {
      const mine = await api("GET", "/orders", { token: bobT });
      assert.ok(mine.body.length > 0 && mine.body.every((o) => o.order_id));
      const aliceIds = (await api("GET", "/orders", { token: aliceT })).body.map((o) => o.order_id);
      assert.ok(!mine.body.some((o) => aliceIds.includes(o.order_id)));
      assert.equal((await api("GET", "/orders/" + firstBuy.order_id, { token: bobT })).status, 403);
      assert.equal((await api("GET", "/orders/999999", { token: bobT })).status, 404);
      assert.equal((await api("GET", "/orders?status=bogus", { token: bobT })).status, 400);
    });

    await test("cancel works while pending and the order never executes", async () => {
      const cashBefore = await cashOf(alice);
      const sharesBefore = await sharesOf(alice);
      const r = await place(aliceT, "buy", 2);
      const del = await api("DELETE", "/orders/" + r.body.order_id, { token: aliceT });
      assert.equal(del.status, 200);
      assert.equal(del.body.status, "canceled");
      assert.ok(del.body.canceled_at);
      await sleep(ORDER_DELAY_S * 1000 + 1200);
      const after = (await api("GET", "/orders/" + r.body.order_id, { token: aliceT })).body;
      assert.equal(after.status, "canceled");
      assert.equal(await cashOf(alice), cashBefore);
      assert.equal(await sharesOf(alice), sharesBefore);
    });

    await test("cancel errors: already canceled or executed 409, someone else's 403, unknown 404", async () => {
      const r = await place(aliceT, "buy", 1);
      await api("DELETE", "/orders/" + r.body.order_id, { token: aliceT });
      assert.equal((await api("DELETE", "/orders/" + r.body.order_id, { token: aliceT })).status, 409, "already canceled");
      assert.equal((await api("DELETE", "/orders/" + firstBuy.order_id, { token: aliceT })).status, 409, "already executed");
      const fresh = await place(aliceT, "buy", 1);
      assert.equal((await api("DELETE", "/orders/" + fresh.body.order_id, { token: bobT })).status, 403);
      assert.equal((await api("DELETE", "/orders/999999", { token: aliceT })).status, 404);
      await api("DELETE", "/orders/" + fresh.body.order_id, { token: aliceT });
    });

    await test("cancel racing the executor: every order ends up executed or canceled, never both", async () => {
      await setPrice("100.00");
      const placed = [];
      for (let i = 0; i < 20; i += 1) {
        placed.push((await place(carolT, "buy", 1)).body.order_id);
      }
      // fire the cancels around the moment the orders become due
      const results = await Promise.all(
        placed.map(async (id) => {
          await sleep(ORDER_DELAY_S * 1000 - 150 + Math.random() * 500);
          const r = await api("DELETE", "/orders/" + id, { token: carolT });
          return { id, status: r.status };
        })
      );
      await sleep(2500);

      const orders = (await api("GET", "/orders", { token: carolT })).body.filter((o) => placed.includes(o.order_id));
      assert.equal(orders.length, 20);
      const byId = new Map(orders.map((o) => [o.order_id, o]));
      let executed = 0;
      let canceled = 0;
      for (const r of results) {
        const o = byId.get(r.id);
        assert.ok(["executed", "canceled"].includes(o.status), "order " + r.id + " ended " + o.status + " (" + (o.reject_reason || "") + ")");
        if (r.status === 200) {
          assert.equal(o.status, "canceled", "a 200 cancel must mean canceled");
          canceled += 1;
        } else {
          assert.equal(r.status, 409, "unexpected cancel status " + r.status);
          assert.equal(o.status, "executed", "a 409 cancel must mean it had executed");
          executed += 1;
        }
      }
      const txns = (await one("SELECT count(*)::int AS n FROM transactions WHERE user_id = $1 AND order_id = ANY($2)", [carol.id, placed])).n;
      assert.equal(txns, executed, "one transaction per executed order, none for canceled ones");
      assert.equal(await sharesOf(carol), executed);
      assert.equal(await cashOf(carol), (100000 - executed * 100).toFixed(2));
      console.log("        (" + executed + " executed, " + canceled + " canceled out of 20)");
    });

    await test("customers cannot use admin routes, an admin can", async () => {
      assert.equal((await api("PUT", "/market", { token: bobT, body: { market_close: "17:00" } })).status, 403);
      assert.equal((await api("PUT", "/market", { token: adminT, body: { market_open: "09:30", market_close: "17:00", trading_days: [1, 2, 3, 4, 5] } })).status, 200);
    });
  } finally {
    // put everything back
    await pool.query("DELETE FROM users WHERE username LIKE $1", ["it\\_%\\_" + stamp]);
    await pool.query(
      `UPDATE market_config SET market_open = $1, market_close = $2, timezone = $3, trading_days = $4,
         holidays = $5, is_open_override = $6 WHERE config_id = 1`,
      [marketBefore.market_open, marketBefore.market_close, marketBefore.timezone, marketBefore.trading_days,
       marketBefore.holidays, marketBefore.is_open_override]
    );
    await pool.query(
      "UPDATE stocks SET current_price = $1, opening_price = $2, day_high = $3, day_low = $4, updated_at = $5 WHERE stock_id = $6",
      [acme.current_price, acme.opening_price, acme.day_high, acme.day_low, acme.updated_at, acme.stock_id]
    );
    api_proc.kill();
    await pool.end();
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
