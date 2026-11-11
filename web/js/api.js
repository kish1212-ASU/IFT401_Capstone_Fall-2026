// ===========================================================
// api.js — the ONLY file that talks to the server.
//
// Every page calls the functions below instead of using fetch()
// itself, so when a server route changes, this is the one file
// that changes. Every function here uses a real route:
//
//   GET /stocks              getStocks()
//   POST /stocks (admin)     createStock()
//   POST /users              createAccount()
//   POST /auth/login         login()        POST /auth/logout  logout()
//   GET /users/me            getMyProfile(), getCashBalance()
//   GET /market              getMarketStatus()
//   PUT /market (admin)      updateMarketHours()
//   POST/GET/DELETE /orders  placeOrder(), getOrders(), cancelOrder()
//   POST /cash/deposit, /cash/withdraw   depositCash(), withdrawCash()
//   GET /portfolio           getPortfolioSummary()
//   GET /transactions        getTransactionHistory()
//
// Request and response shapes are in docs/api-contract.md.
// Auth is a JWT. Login returns { token, user_id, username, role };
// authFetch() adds `Authorization: Bearer <token>` for you.
// Tokens expire after 4 hours.
// ===========================================================

// On your own computer the API is on port 3000. On the deployed site,
// nginx forwards /api/... to the API and strips the "/api" prefix.
const API_BASE = ["", "localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:3000"
  : "/api";

const NETWORK_ERROR = "Couldn't reach the server. Is the API running?";

// Turns a fetch Response into { success, status, error, body }.
// The server always sends errors as { "error": "message" }.
function _result(res) {
  return res.json().catch(() => ({})).then(body => ({
    success: res.ok,
    status: res.status,
    error: res.ok ? null : (body.error || `Request failed (${res.status}).`),
    body,
  }));
}

function _json(method, payload) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// Turns a raw share count (e.g. 12400000) into "12.4M".
function _formatVolume(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// Earlier versions of this site kept practice data in the browser
// (fake cash, holdings, orders, market hours, transactions, demo
// stocks, a fake login). All of that is on the server now, so clear
// any leftovers from a browser that used an older version.
["stocksim_mock_cash", "stocksim_mock_portfolio", "stocksim_mock_pending",
 "stocksim_mock_market", "stocksim_mock_transactions", "stocksim_mock_session",
 "stocksim_mock_created_stocks",
].forEach(k => localStorage.removeItem(k));

// ===========================================================
// SESSION (Login / Logout / "who's logged in")
//
// POST /auth/login returns { token, user_id, username, role }. We keep
// all of that in localStorage so it survives navigating between pages
// (each HTML page is its own separate JS context).
//
// SECURITY NOTE: localStorage is readable by any script on the page.
// That's an accepted tradeoff for this class project (the contract
// chose bearer tokens on purpose), but never paste a token into chat,
// Discord, or a screenshot.
//
// getCurrentUser() checks the token's expiry itself and quietly logs
// you out when it passes, so the nav never claims you're logged in
// with a dead token.
// ===========================================================

const SESSION_KEY = "stocksim_session";

// Reads the "exp" (expiry, in seconds) out of a JWT without verifying
// it — verifying is the server's job, we only want to know if it's
// obviously expired.
function _tokenExpired(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    return typeof exp === "number" && exp * 1000 <= Date.now();
  } catch (e) {
    return true; // unreadable token — treat as expired
  }
}

function getCurrentUser() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.token || _tokenExpired(session.token)) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session; // { user_id, username, role, token }
  } catch (e) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function _setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

// Same as fetch(), but adds the Authorization header when logged in.
// Use this for every route the contract marks (auth) or (admin).
// If the server answers 401 (token expired, tampered with, or the
// server's secret changed) we drop the dead session and reload, so
// the page shows the "log in" prompt instead of failing silently.
function authFetch(path, options = {}) {
  const { skipReload, ...fetchOptions } = options;
  const user = getCurrentUser();
  const headers = { ...(fetchOptions.headers || {}) };
  if (user) headers["Authorization"] = `Bearer ${user.token}`;
  return fetch(`${API_BASE}${path}`, { ...fetchOptions, headers }).then(res => {
    if (res.status === 401 && user) {
      localStorage.removeItem(SESSION_KEY);
      if (!skipReload) setTimeout(() => location.reload(), 0);
    }
    return res;
  });
}

// ---------------- Login (POST /auth/login) ----------------
// 200: { token, user_id, username, role }
// 400: { error } missing field    401: { error } bad credentials
function login({ username, password }) {
  return fetch(`${API_BASE}/auth/login`, _json("POST", { username, password }))
    .then(_result)
    .then(r => {
      if (!r.success) return { success: false, error: r.error };
      _setSession({
        user_id: r.body.user_id,
        username: r.body.username,
        role: r.body.role,
        token: r.body.token,
      });
      return { success: true, user: getCurrentUser() };
    })
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// ---------------- Logout (POST /auth/logout) ----------------
// Tokens are stateless, so the server only answers 204. The real
// logout is deleting our copy, which we do no matter what the
// server says (even if the API is down).
function logout() {
  return authFetch("/auth/logout", { method: "POST", skipReload: true })
    .catch(() => null)
    .then(() => {
      localStorage.removeItem(SESSION_KEY);
      return { success: true };
    });
}

// ---------------- My profile (GET /users/me, auth) ----------------
// Same shape as POST /users, including cash_balance (a string).
function getMyProfile() {
  return authFetch("/users/me")
    .then(_result)
    .then(r => ({ success: r.success, error: r.error, user: r.success ? r.body : null }))
    .catch(() => ({ success: false, error: NETWORK_ERROR, user: null }));
}

// The account's real cash balance as a number, or null if it couldn't
// be loaded.
function getCashBalance() {
  return getMyProfile().then(r => (r.success ? Number(r.user.cash_balance) : null));
}

// ===========================================================
// ACCOUNTS
// ===========================================================

// ---------------- Create Account (POST /users) ----------------
// 201: { user_id, username, email, full_name, role, cash_balance, ... }
// 400 missing field, 409 username or email taken.
function createAccount({ fullName, username, email, password }) {
  return fetch(`${API_BASE}/users`, _json("POST", {
    username, email, full_name: fullName, password,
  }))
    .then(_result)
    .then(r => ({ success: r.success, error: r.error, user: r.success ? r.body : null }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// ===========================================================
// STOCKS
// ===========================================================

// ---------------- Stock Listing (GET /stocks) ----------------
// Real columns: stock_id, ticker, company_name, current_price (string),
// opening_price, day_high, day_low, volume, market_cap (string,
// computed by the server) — translated into the shape the pages use.
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
        stockId: r.stock_id,
        ticker: r.ticker,
        company: r.company_name,
        price: price,
        change: Math.round(changePct * 100) / 100,
        volume: _formatVolume(Number(r.volume)),
        marketCap: Number(r.market_cap),
        openingPrice: opening,
        dayHigh: Number(r.day_high),
        dayLow: Number(r.day_low),
      };
    }));
}

// ---------------- Create Stock (POST /stocks, admin) ----------------
// Request: { ticker, company_name, initial_price, volume }.
// 201: the new stock (its current, open, high and low prices all start
// at initial_price). 400 bad field, 403 not admin, 409 ticker exists.
function createStock({ companyName, ticker, volume, initialPrice }) {
  return authFetch("/stocks", _json("POST", {
    ticker: ticker.toUpperCase(),
    company_name: companyName,
    initial_price: String(initialPrice),
    volume: Number(volume),
  }))
    .then(_result)
    .then(r => ({ success: r.success, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// ===========================================================
// ORDERS  POST/GET/DELETE /orders
//
// An order is created as "pending" and the server fills it about 8
// seconds later (the window to cancel). Funds, shares, market hours
// and price are all checked when it fills, so a pending order can
// still end up "rejected" (e.g. insufficient funds). The client never
// sends a price — the server reads it when the order fills.
// Statuses: pending, executed, canceled, rejected.
// ===========================================================

function _mapOrder(o) {
  return {
    orderId: o.order_id,
    stockId: o.stock_id,
    ticker: o.ticker,
    orderType: o.order_type,
    quantity: o.quantity,
    status: o.status,
    executesAt: o.executes_at ? new Date(o.executes_at).getTime() : null,
    executedPrice: o.executed_price == null ? null : Number(o.executed_price),
    totalAmount: o.total_amount == null ? null : Number(o.total_amount),
    rejectReason: o.reject_reason,
    createdAt: o.created_at,
    executedAt: o.executed_at,
    canceledAt: o.canceled_at,
  };
}

// 201: the pending order.  400 bad input, 404 no such stock,
// 409 market closed.
function placeOrder({ stockId, orderType, quantity }) {
  return authFetch("/orders", _json("POST", {
    stock_id: Number(stockId),
    order_type: orderType,
    quantity: Number(quantity),
  }))
    .then(_result)
    .then(r => (r.success
      ? { success: true, order: _mapOrder(r.body) }
      : { success: false, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// All of this user's orders, newest first. Optional status filter.
function getOrders(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return authFetch(`/orders${query}`)
    .then(_result)
    .then(r => (r.success
      ? { success: true, orders: r.body.map(_mapOrder) }
      : { success: false, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// Cancels a pending order. 409 if it already executed, was rejected,
// or was already canceled.
function cancelOrder(orderId) {
  return authFetch(`/orders/${orderId}`, { method: "DELETE" })
    .then(_result)
    .then(r => ({ success: r.success, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// ===========================================================
// MARKET  GET /market, PUT /market (admin)
//
// The server decides whether the market is open (hours, weekday,
// holidays, in the market's own time zone). The pages only display it.
// Only weekdays (1 = Monday ... 5 = Friday) can be trading days.
// ===========================================================

function _mapMarket(m) {
  return {
    isOpen: m.is_open,
    marketOpen: m.market_open,
    marketClose: m.market_close,
    timezone: m.timezone,
    tradingDays: m.trading_days,
    holidays: m.holidays,
    serverTime: m.server_time,
  };
}

function getMarketStatus() {
  return fetch(`${API_BASE}/market`)
    .then(_result)
    .then(r => (r.success
      ? { success: true, market: _mapMarket(r.body) }
      : { success: false, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// Any of the fields can be sent; ones left out keep their value.
// 400 with a clear message if something's invalid, 403 if not admin.
function updateMarketHours({ marketOpen, marketClose, timezone, tradingDays, holidays }) {
  return authFetch("/market", _json("PUT", {
    market_open: marketOpen,
    market_close: marketClose,
    timezone,
    trading_days: tradingDays,
    holidays,
  }))
    .then(_result)
    .then(r => (r.success
      ? { success: true, market: _mapMarket(r.body) }
      : { success: false, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// ===========================================================
// CASH  POST /cash/deposit, /cash/withdraw
//
// Request { amount: "500.00" }. 201: { transaction_id,
// transaction_type, total_amount, balance_after, created_at }.
// 400 bad amount, 409 insufficient funds (withdraw).
// The server accepts a positive amount with at most 2 decimals.
// ===========================================================

function _cashRequest(path, amount) {
  const text = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return Promise.resolve({
      success: false,
      error: "Enter an amount greater than 0 with at most 2 decimal places.",
    });
  }
  return authFetch(path, _json("POST", { amount: text }))
    .then(_result)
    .then(r => (r.success
      ? { success: true, newBalance: Number(r.body.balance_after) }
      : { success: false, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

function depositCash(amount) { return _cashRequest("/cash/deposit", amount); }
function withdrawCash(amount) { return _cashRequest("/cash/withdraw", amount); }

// ===========================================================
// PORTFOLIO  GET /portfolio
//
// Response: { cash_balance, holdings_value, total_value,
// holdings: [{ stock_id, ticker, company_name, quantity,
// avg_cost_basis, current_price, market_value, gain_loss }] }.
// The server works out every value from the current price.
// ===========================================================

function getPortfolioSummary() {
  return authFetch("/portfolio")
    .then(_result)
    .then(r => {
      if (!r.success) return { success: false, error: r.error };
      const p = r.body;
      return {
        success: true,
        cashBalance: Number(p.cash_balance),
        holdingsValue: Number(p.holdings_value),
        totalValue: Number(p.total_value),
        holdings: p.holdings.map(h => ({
          ticker: h.ticker,
          company: h.company_name,
          quantity: h.quantity,
          price: Number(h.current_price),
          marketValue: Number(h.market_value),
          avgCostBasis: Number(h.avg_cost_basis),
          gainLoss: Number(h.gain_loss),
        })),
      };
    })
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}

// ===========================================================
// HISTORY  GET /transactions
//
// Newest first. Buys, sells, deposits and withdrawals:
// { transaction_id, transaction_type, ticker, quantity,
//   price_per_share, total_amount, balance_after, created_at }.
// ticker, quantity and price_per_share are null for cash transactions.
// ===========================================================

function getTransactionHistory() {
  return authFetch("/transactions")
    .then(_result)
    .then(r => (r.success
      ? {
          success: true,
          rows: r.body.map(t => ({
            id: t.transaction_id,
            date: t.created_at,
            type: t.transaction_type,
            ticker: t.ticker,
            quantity: t.quantity,
            pricePerShare: t.price_per_share == null ? null : Number(t.price_per_share),
            total: Number(t.total_amount),
            balanceAfter: Number(t.balance_after),
          })),
        }
      : { success: false, error: r.error }))
    .catch(() => ({ success: false, error: NETWORK_ERROR }));
}
