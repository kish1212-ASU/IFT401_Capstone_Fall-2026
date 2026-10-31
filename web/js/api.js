// ===========================================================
// api.js — THE ONLY FILE THAT SHOULD CHANGE WHEN ALEX'S REAL
// BACKEND IS READY.
//
// STATUS (as of Oct 1, after PRs #2, #3, #4 merged into main):
//   REAL:  GET /health, GET /stocks, POST /users (create account),
//          POST /auth/login, POST /auth/logout, GET /users/me
//   STILL MOCK (routes not built yet): POST /stocks (admin), market
//          hours, orders, cash deposit/withdraw, portfolio, transactions.
//          Those mocks use the exact field names from
//          docs/api-contract.md so each swap is small.
//
//   Auth is a JWT. Login returns { token, user_id, username, role }.
//   The token goes on every (auth) request as
//   `Authorization: Bearer <token>` — use authFetch() below, which
//   adds it for you. Tokens expire after 4 hours.
//
//   Account creation is POST /users (not /accounts — Kyle is
//   keeping "user" the person separate from "account" the cash
//   account in the schema).
// ===========================================================

const API_BASE = ["", "localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:3000"
  : "/api";

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
// SESSION (Login / Logout / "who's logged in")  — REAL as of PR #3
//
// POST /auth/login returns { token, user_id, username, role }. We keep
// all of that in localStorage so it survives navigating between pages
// (each HTML page is its own separate JS context, so a plain variable
// would be forgotten on every click).
//
// SECURITY NOTE: localStorage is readable by any script on the page.
// That's an accepted tradeoff for this class project (Kyle's contract
// chose bearer tokens on purpose), but never paste a token into chat,
// Discord, or a screenshot.
//
// The token is a JWT that expires after 4 hours. getCurrentUser()
// checks the expiry itself and quietly logs you out when it passes,
// so the nav never claims you're logged in with a dead token.
// ===========================================================

const SESSION_KEY = "stocksim_session";

// Reads the "exp" (expiry, in seconds) out of a JWT without verifying
// it — verifying is the server's job, we only want to know if it's
// obviously expired so we can stop showing a stale "logged in".
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
function authFetch(path, options = {}) {
  const user = getCurrentUser();
  const headers = { ...(options.headers || {}) };
  if (user) headers["Authorization"] = `Bearer ${user.token}`;
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

// ---------------- Login (REAL — POST /auth/login) ----------------
// 200: { token, user_id, username, role }
// 400: { error } missing field    401: { error } bad credentials
function login({ username, password }) {
  return fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
    .then(res =>
      res.json().then(body => {
        if (!res.ok) return { success: false, error: body.error || "Login failed." };
        _setSession({
          user_id: body.user_id,
          username: body.username,
          role: body.role,
          token: body.token,
        });
        return { success: true, user: getCurrentUser() };
      })
    )
    .catch(() => ({
      success: false,
      error: "Couldn't reach the server. Is the API running on port 3000?",
    }));
}

// ---------------- Logout (REAL — POST /auth/logout) ----------------
// Tokens are stateless, so the server only answers 204. The real
// logout is deleting our copy, which we do no matter what the
// server says (even if the API is down).
function logout() {
  return authFetch("/auth/logout", { method: "POST" })
    .catch(() => null)
    .then(() => {
      localStorage.removeItem(SESSION_KEY);
      return { success: true };
    });
}

// ---------------- My profile (REAL — GET /users/me, auth) ----------------
// Same shape as POST /users, including cash_balance (a string).
// Not shown anywhere yet; it's here for when the cash/portfolio
// routes land, and it's a handy way to check the token works.
function getMyProfile() {
  return authFetch("/users/me").then(res =>
    res.json().then(body => ({
      success: res.ok,
      error: res.ok ? null : body.error,
      user: res.ok ? body : null,
    }))
  );
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
        stockId: r.stock_id,
        ticker: r.ticker,
        company: r.company_name,
        price: price,
        change: Math.round(changePct * 100) / 100,
        volume: _formatVolume(Number(r.volume)),
        marketCap: Number(r.market_cap), // server already computes this — no need to re-derive it
        openingPrice: opening,
        dayHigh: Number(r.day_high),
        dayLow: Number(r.day_low),
      };
    }))
    .then(realStocks => {
      // Stocks created through the mock admin form (see createStock below)
      // don't exist in the real database, so they're appended here purely
      // client-side. They won't fluctuate with the real price generator
      // since nothing on the server knows about them.
      const mockStocks = _loadMockCreatedStocks();
      return [...realStocks, ...mockStocks];
    });
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
// REAL as of PR #2 (Alex), merged into main. Login below is still mocked
// until PR #3 (JWT auth) merges — so an account created here is real in
// Alex's database, but you can't log into it yet with this same page.
function createAccount({ fullName, username, email, password }) {
  return fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, full_name: fullName, password }),
  })
    .then(res =>
      res.json().then(body => ({
        success: res.ok,
        error: res.ok ? null : body.error,
        user: res.ok ? body : null,
      }))
    )
    .catch(() => ({
      success: false,
      error: "Couldn't reach the server. Is the API running on port 3000?",
    }));
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
// Stocks created through the mock admin form, kept in localStorage so
// they actually show up in getStocks() below — otherwise "creating" a
// stock would have no visible effect anywhere, which would look broken
// in a screenshot. Real duplicate-ticker checking happens against BOTH
// this list and whatever the real /stocks endpoint currently has.
const MOCK_CREATED_STOCKS_KEY = "stocksim_mock_created_stocks";

function _loadMockCreatedStocks() {
  const raw = localStorage.getItem(MOCK_CREATED_STOCKS_KEY);
  return raw ? JSON.parse(raw) : [];
}
function _saveMockCreatedStocks(list) {
  localStorage.setItem(MOCK_CREATED_STOCKS_KEY, JSON.stringify(list));
}

function createStock({ companyName, ticker, volume, initialPrice }) {
  ticker = ticker.toUpperCase();
  return getStocks().then(realStocks => {
    const mockStocks = _loadMockCreatedStocks();
    const exists = [...realStocks, ...mockStocks].some(s => s.ticker === ticker);
    if (exists) {
      return { success: false, error: "Ticker already exists." };
    }

    const price = Number(initialPrice);
    mockStocks.push({
      stockId: `mock-${ticker}`,
      ticker,
      company: companyName,
      price,
      change: 0,
      volume: _formatVolume(Number(volume)),
      marketCap: price * Number(volume),
      openingPrice: price, // brand new — opens at its own initial price
      dayHigh: price,
      dayLow: price,
    });
    _saveMockCreatedStocks(mockStocks);
    return { success: true };
  });
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
      _logTransaction({
        transactionType: order.type,
        ticker: order.ticker,
        quantity: order.quantity,
        pricePerShare: order.price,
        totalAmount: order.price * order.quantity,
        balanceAfter: cash,
      });
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

  if (!getMarketStatus().isOpen) {
    return _fakeDelay({ success: false, error: "Market is closed. Trades can only be placed during market hours." });
  }

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

  if (!getMarketStatus().isOpen) {
    return _fakeDelay({ success: false, error: "Market is closed. Trades can only be placed during market hours." });
  }

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
  _logTransaction({
    transactionType: "deposit",
    ticker: null,
    quantity: null,
    pricePerShare: null,
    totalAmount: amount,
    balanceAfter: newBalance,
  });
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
  _logTransaction({
    transactionType: "withdrawal",
    ticker: null,
    quantity: null,
    pricePerShare: null,
    totalAmount: amount,
    balanceAfter: newBalance,
  });
  return _fakeDelay({ success: true, newBalance });
}

// ---------------- Portfolio (SPEC ONLY — GET /portfolio) ----------------
// Contract response: { cash_balance, holdings_value, total_value, holdings[] }
// Real holdings also include avg_cost_basis and gain_loss — our mock
// doesn't track purchase cost, only current quantity, so those two
// fields are left out here until either the real endpoint exists or
// someone extends the mock to track cost basis on each buy.
//
// TODO: once GET /portfolio is real, swap this for a plain:
//   return fetch(`${API_BASE}/portfolio`).then(res => res.json());
function getPortfolioSummary() {
  _settlePendingOrders();
  const cash = _loadCash();
  const portfolio = _loadPortfolio(); // { ticker: quantity }

  return getStocks().then(stocks => {
    const holdings = Object.entries(portfolio)
      .filter(([, qty]) => qty > 0)
      .map(([ticker, quantity]) => {
        const stock = stocks.find(s => s.ticker === ticker);
        const price = stock ? stock.price : 0;
        return {
          ticker,
          company: stock ? stock.company : "(unknown — not in current listing)",
          quantity,
          price,
          marketValue: price * quantity,
        };
      });

    const holdingsValue = holdings.reduce((sum, h) => sum + h.marketValue, 0);

    return {
      cashBalance: cash,
      holdingsValue,
      totalValue: cash + holdingsValue,
      holdings,
    };
  });
}

// ===========================================================
// MOCK MARKET HOURS (GET /market, PUT /market — admin)
//
// NOTE ON TIMEZONES: the real contract stores hours as local clock
// time + a named IANA timezone (e.g. "America/New_York") so 9:30
// stays 9:30 through DST changes. Doing that conversion correctly
// in plain JS needs real timezone-aware logic. This mock instead
// just compares against the BROWSER's own local time — good enough
// to demo the open/closed behavior, not something to treat as
// correct once the real backend (which should do this properly)
// exists.
// ===========================================================

const MARKET_KEY = "stocksim_mock_market";

// Deliberately wide open by default (all 7 days, effectively 24hr) so that
// testing/demoing buy and sell doesn't randomly break depending on what
// time of day or day of week someone happens to be clicking around. Use
// the Market Hours admin page to narrow this to real hours (e.g. 9:30–16:00
// Eastern, weekdays only) specifically when you want to DEMONSTRATE the
// restriction — narrow it, show a trade get rejected, then widen it back.
function _defaultMarket() {
  return {
    marketOpen: "00:00",
    marketClose: "23:59",
    timezone: "America/New_York",
    tradingDays: [1, 2, 3, 4, 5, 6, 7], // ISO weekday, 1 = Monday
    holidays: [],
  };
}

function _loadMarket() {
  const raw = localStorage.getItem(MARKET_KEY);
  return raw ? JSON.parse(raw) : _defaultMarket();
}

function _saveMarket(m) {
  localStorage.setItem(MARKET_KEY, JSON.stringify(m));
}

// IMPORTANT: marketOpen/marketClose are meant to be in the market's own
// timezone (e.g. Eastern), not the viewer's local time — someone testing
// from Arizona is 2-3 hours off from New York depending on the time of
// year, and comparing raw local time against these numbers would be wrong.
// This uses Intl to figure out what day/time it actually is IN that
// timezone right now, rather than trusting the browser's local clock.
function _nowInMarketTimezone(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date());

  const get = (type) => parts.find(p => p.type === type).value;
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
    isoWeekday: weekdayMap[get("weekday")],
  };
}

// TODO: once real, swap this for:
//   return fetch(`${API_BASE}/market`).then(res => res.json());
function getMarketStatus() {
  const m = _loadMarket();
  const { dateStr, hhmm, isoWeekday } = _nowInMarketTimezone(m.timezone);

  const isTradingDay = m.tradingDays.includes(isoWeekday);
  const isHoliday = m.holidays.includes(dateStr);
  const withinHours = hhmm >= m.marketOpen && hhmm < m.marketClose;

  return {
    isOpen: isTradingDay && !isHoliday && withinHours,
    marketOpen: m.marketOpen,
    marketClose: m.marketClose,
    timezone: m.timezone,
    tradingDays: m.tradingDays,
    holidays: m.holidays,
  };
}

// TODO: once real, swap this for:
//   return fetch(`${API_BASE}/market`, {
//     method: "PUT",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ market_open, market_close, timezone, trading_days, holidays }),
//   }).then(res => res.json().then(body => ({ success: res.ok, error: res.ok ? null : body.error })));
function updateMarketHours({ marketOpen, marketClose, timezone, tradingDays, holidays }) {
  if (marketClose <= marketOpen) {
    return _fakeDelay({ success: false, error: "Close time must be after open time." });
  }
  _saveMarket({ marketOpen, marketClose, timezone, tradingDays, holidays });
  return _fakeDelay({ success: true });
}

// ===========================================================
// MOCK TRANSACTION HISTORY (GET /transactions)
//
// Logs every buy/sell execution and every deposit/withdrawal so
// the Transaction History page has something real to show. Stored
// in localStorage like everything else in this mock.
// ===========================================================

const TRANSACTIONS_KEY = "stocksim_mock_transactions";

function _loadTransactions() {
  const raw = localStorage.getItem(TRANSACTIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function _logTransaction(entry) {
  const list = _loadTransactions();
  list.unshift({
    transactionId: Date.now(),
    createdAt: new Date().toISOString(),
    ...entry,
  });
  localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(list));
}

// TODO: once real, swap this for:
//   return fetch(`${API_BASE}/transactions`).then(res => res.json());
function getTransactionHistory() {
  return _loadTransactions(); // already stored newest-first
}
