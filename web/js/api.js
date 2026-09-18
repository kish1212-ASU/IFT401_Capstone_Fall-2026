// ===========================================================
// api.js — THE ONLY FILE THAT SHOULD CHANGE WHEN ALEX'S REAL
// BACKEND IS READY.
//
// STATUS (per Kyle's docs/api-contract.md, Sept 16):
//   /health and /stocks are REAL. Everything else below is
//   SPEC ONLY — Kyle was explicit these routes don't exist on
//   the server yet, so this file still fakes them, but now
//   matches his exact field names and response shapes so the
//   eventual swap is close to copy-paste instead of guessing.
//
//   Account creation is POST /users (not /accounts — Kyle is
//   keeping "user" the person separate from "account" the cash
//   account in the schema).
//
//   IMPORTANT: almost every route other than /stocks and /users
//   requires a logged-in session per the contract (auth).
//   Nobody has built a login page yet. Buy/Sell/Deposit/Withdraw
//   will need one to work for real, even after Kyle/Alex build
//   the routes themselves.
// ===========================================================

const API_BASE = "http://localhost:3000";

// Fake "existing accounts" so login and the uniqueness check have
// something to check against. Delete this once /users is real.
// NOTE: storing plaintext password here only because this is a
// fake in-browser mock. A real backend hashes passwords and would
// never store or compare them like this.
const _mockAccounts = [
  { username: "jsmith", email: "jsmith@example.com", password: "password123", fullName: "Jane Smith" },
];

// Small helper so the still-mocked functions "feel" like a real
// network call (takes a beat, can fail) instead of resolving instantly.
function _fakeDelay(result, ms = 500) {
  return new Promise(resolve => setTimeout(() => resolve(result), ms));
}

// Turns a raw share count (e.g. 12400000) into the "12.4M" style
// string the pages already know how to display.
function _formatVolume(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ===========================================================
// MOCK SESSION (Login / Logout / "who's logged in")
//
// Stored in localStorage (not just a JS variable) specifically so
// it survives navigating between pages — each HTML page is its own
// separate JS context, so without this the nav bar would "forget"
// you were logged in the second you clicked to a different page.
//
// TODO: once POST /auth/login is real, the contract says auth is
// "session or token based, TBD" — this localStorage approach will
// likely get replaced with a real cookie/token then, not stay as-is.
// ===========================================================

const SESSION_KEY = "stocksim_mock_session";

function getCurrentUser() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function _setCurrentUser(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

// ---------------- Login (SPEC ONLY — POST /auth/login) ----------------
// Contract request body: { username, password }
// Contract 200 response: { user_id, username, role }
// Contract 401: { "error": "..." } on bad credentials
//
// TODO: once POST /auth/login is real, swap this for:
//   return fetch(`${API_BASE}/auth/login`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ username, password }),
//   }).then(res => res.json().then(body => {
//     if (res.ok) _setCurrentUser(body);
//     return { success: res.ok, error: res.ok ? null : body.error };
//   }));
function login({ username, password }) {
  const account = _mockAccounts.find(
    a => a.username === username && a.password === password
  );
  if (!account) {
    return _fakeDelay({ success: false, error: "Incorrect username or password." });
  }
  const user = { user_id: _mockAccounts.indexOf(account) + 1, username: account.username, role: "customer" };
  _setCurrentUser(user);
  return _fakeDelay({ success: true, user });
}

// ---------------- Logout (SPEC ONLY — POST /auth/logout) ----------------
// TODO: once real, also call POST /auth/logout so the server drops
// the session, then still clear the local copy below either way.
function logout() {
  localStorage.removeItem(SESSION_KEY);
  return _fakeDelay({ success: true });
}

// ---------------- Stock Listing (REAL) ----------------
// Hits Alex's actual GET /stocks endpoint. Real columns per the
// contract: stock_id, ticker, company_name, current_price (string),
// opening_price, day_high, day_low, volume, market_cap (string,
// server-computed) — translated below into the shape index.html
// already knows how to display, so that file didn't need changes.
function getStocks() {
  return fetch(`${API_BASE}/stocks`)
    .then(res => {
      if (!res.ok) throw new Error("Failed to load stocks");
      return res.json();
    })
    .then(rows => rows.map(r => {
      const price = Number(r.current_price);
      const opening = Number(r.opening_price) || price;
      const changePct = opening ? ((price - opening) / opening) * 100 : 0;
      return {
        ticker: r.ticker,
        company: r.company_name,
        price: price,
        change: Math.round(changePct * 100) / 100,
        volume: _formatVolume(Number(r.volume)),
        marketCap: Number(r.market_cap), // server already computes this — no need to re-derive it
      };
    }));
}

// ---------------- Create Account (SPEC ONLY — POST /users) ----------------
// Contract request body: { username, email, full_name, password }
// Contract 201 response: { user_id, username, email, full_name,
//   role, cash_balance, created_at } — never includes password_hash.
// Contract 409: { "error": "..." } when username or email is taken.
//
// TODO: once POST /users is real, swap this for:
//   return fetch(`${API_BASE}/users`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       username, email, full_name: fullName, password,
//     }),
//   }).then(res => res.json().then(body => ({
//     success: res.ok,
//     error: res.ok ? null : body.error,
//     user: res.ok ? body : null,
//   })));
function createAccount({ fullName, username, email, password }) {
  const taken = _mockAccounts.some(
    a => a.username === username || a.email === email
  );
  if (taken) {
    return _fakeDelay({ success: false, error: "Username or email already taken." });
  }
  _mockAccounts.push({ username, email, password, fullName });
  return _fakeDelay({
    success: true,
    user: {
      user_id: _mockAccounts.length,
      username,
      email,
      full_name: fullName,
      role: "customer",
      cash_balance: "0.00",
    },
  });
}

// ---------------- Create Stock (SPEC ONLY — POST /stocks, admin) ----------------
// Contract request body: { ticker, company_name, initial_price, volume }
// Contract 201 response: same shape as GET /stocks/:id.
// Contract 409: { "error": "..." } when the ticker already exists.
//
// TODO: once POST /stocks (admin) is real, swap this for:
//   return fetch(`${API_BASE}/stocks`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       ticker, company_name: companyName,
//       initial_price: initialPrice, volume,
//     }),
//   }).then(res => res.json().then(body => ({
//     success: res.ok,
//     error: res.ok ? null : body.error,
//   })));
const _mockStocks = [
  { ticker: "AAPL", company: "Apple Inc.", price: 187.42, change: 0.63, volume: "12.4M" },
  { ticker: "TSLA", company: "Tesla Inc.", price: 241.05, change: -1.12, volume: "9.8M" },
];

function createStock({ companyName, ticker, volume, initialPrice }) {
  const exists = _mockStocks.some(s => s.ticker.toLowerCase() === ticker.toLowerCase());
  if (exists) {
    return _fakeDelay({ success: false, error: "Ticker already exists." });
  }
  _mockStocks.push({
    ticker: ticker.toUpperCase(),
    company: companyName,
    price: Number(initialPrice),
    change: 0,
    volume: Number(volume).toLocaleString(),
  });
  return _fakeDelay({ success: true });
}

// ---------------- Not built yet (stub pages use these) ----------------
// TODO: buy/sell/deposit/withdraw need real backend logic
// (market-hours check, cash/share balance check, pending-order
// cancel) before these are worth wiring up. See buy.html / sell.html
// / deposit-withdraw.html for the "coming soon" placeholders.

// ===========================================================
// MOCK TRADING STATE (Buy / Sell / Deposit / Withdraw)
//
// This simulates the pending-order + cancel behavior from the
// process maps entirely in the browser, with no backend at all.
//
// FIXED (previous version had a real bug): cash/portfolio/pending
// orders used to live only in that one page's JS memory, so
// navigating to a different page — or a pending order's timer
// firing after you'd already left — lost everything. Now this is
// stored in localStorage (same approach as the login session), so
// it survives navigating between pages and even closing the tab.
//
// Pending orders no longer rely on setTimeout at all, since a timer
// dies the moment you navigate away. Instead, every read of state
// first "settles" any pending order whose time has passed based on
// the clock, not on a timer having survived. That's why every page
// that shows pending orders polls every second — each poll is also
// what triggers overdue orders to actually execute.
//
// TODO (whoever builds buy/sell/deposit/withdraw on the server):
// replace every function below with real fetch() calls the same
// way getStocks() was swapped from mock to real earlier.
// ===========================================================

const CASH_KEY = "stocksim_mock_cash";
const PORTFOLIO_KEY = "stocksim_mock_portfolio";
const PENDING_KEY = "stocksim_mock_pending";
const PENDING_WINDOW_MS = 8000; // how long an order stays cancelable before it "executes"

function _loadCash() {
  const raw = localStorage.getItem(CASH_KEY);
  return raw !== null ? Number(raw) : 5000.00; // starting balance
}
function _saveCash(v) {
  localStorage.setItem(CASH_KEY, String(v));
}

function _loadPortfolio() {
  const raw = localStorage.getItem(PORTFOLIO_KEY);
  return raw ? JSON.parse(raw) : {};
}
function _savePortfolio(p) {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(p));
}

function _loadRawPending() {
  const raw = localStorage.getItem(PENDING_KEY);
  return raw ? JSON.parse(raw) : [];
}
function _savePending(list) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

// Executes any pending order whose time has come (based on the
// clock, not a timer), updates cash/portfolio accordingly, and
// returns whatever's still genuinely pending.
function _settlePendingOrders() {
  const pending = _loadRawPending();
  let cash = _loadCash();
  const portfolio = _loadPortfolio();
  const now = Date.now();
  const stillPending = [];

  for (const order of pending) {
    if (order.executesAt <= now) {
      if (order.type === "buy") {
        cash -= order.price * order.quantity;
        portfolio[order.ticker] = (portfolio[order.ticker] || 0) + order.quantity;
      } else {
        portfolio[order.ticker] = (portfolio[order.ticker] || 0) - order.quantity;
        cash += order.price * order.quantity;
      }
    } else {
      stillPending.push(order);
    }
  }

  _saveCash(cash);
  _savePortfolio(portfolio);
  _savePending(stillPending);
  return stillPending;
}

function getMockCashBalance() {
  _settlePendingOrders();
  return _loadCash();
}

function getMockPortfolio() {
  _settlePendingOrders();
  return _loadPortfolio();
}

function getPendingOrders() {
  return _settlePendingOrders();
}

function submitBuyOrder({ ticker, quantity, price }) {
  quantity = Number(quantity);
  _settlePendingOrders();
  const cash = _loadCash();
  const cost = quantity * price;

  if (!quantity || quantity <= 0) {
    return _fakeDelay({ success: false, error: "Enter a quantity greater than 0." });
  }
  if (cost > cash) {
    return _fakeDelay({ success: false, error: "Insufficient cash balance for this order." });
  }

  const pending = _loadRawPending();
  const order = {
    id: Date.now(), // fine for a demo — real orders get a real DB-assigned id
    type: "buy",
    ticker,
    quantity,
    price,
    executesAt: Date.now() + PENDING_WINDOW_MS,
  };
  pending.push(order);
  _savePending(pending);

  return _fakeDelay({ success: true, orderId: order.id });
}

function submitSellOrder({ ticker, quantity, price }) {
  quantity = Number(quantity);
  _settlePendingOrders();
  const owned = _loadPortfolio()[ticker] || 0;

  if (!quantity || quantity <= 0) {
    return _fakeDelay({ success: false, error: "Enter a quantity greater than 0." });
  }
  if (quantity > owned) {
    return _fakeDelay({ success: false, error: `You only own ${owned} share(s) of ${ticker}.` });
  }

  const pending = _loadRawPending();
  const order = {
    id: Date.now(),
    type: "sell",
    ticker,
    quantity,
    price,
    executesAt: Date.now() + PENDING_WINDOW_MS,
  };
  pending.push(order);
  _savePending(pending);

  return _fakeDelay({ success: true, orderId: order.id });
}

function cancelOrder(orderId) {
  _settlePendingOrders(); // in case it already executed since the last check
  const pending = _loadRawPending();
  const idx = pending.findIndex(o => o.id === orderId);
  if (idx === -1) {
    return _fakeDelay({ success: false, error: "Order already executed or not found." });
  }
  pending.splice(idx, 1);
  _savePending(pending);
  return _fakeDelay({ success: true });
}

function depositCash(amount) {
  amount = Number(amount);
  if (!amount || amount <= 0) {
    return _fakeDelay({ success: false, error: "Enter an amount greater than 0." });
  }
  const newBalance = _loadCash() + amount;
  _saveCash(newBalance);
  return _fakeDelay({ success: true, newBalance });
}

function withdrawCash(amount) {
  amount = Number(amount);
  if (!amount || amount <= 0) {
    return _fakeDelay({ success: false, error: "Enter an amount greater than 0." });
  }
  const cash = _loadCash();
  if (amount > cash) {
    return _fakeDelay({ success: false, error: "Insufficient cash balance." });
  }
  const newBalance = cash - amount;
  _saveCash(newBalance);
  return _fakeDelay({ success: true, newBalance });
}
