// ---------------------------------------------------------
// Shared nav bar. Every page has an empty <div id="site-nav"></div>
// near the top of <body>, and calls renderNav("pageId") after it.
// Editing the nav only ever happens in this one file.
// ---------------------------------------------------------

const NAV_LINKS = [
  { id: "listing", label: "Stocks", href: "index.html" },
  { id: "buy", label: "Buy", href: "buy.html" },
  { id: "sell", label: "Sell", href: "sell.html" },
  { id: "cash", label: "Deposit/Withdraw", href: "deposit-withdraw.html" },
  { id: "portfolio", label: "Portfolio", href: "portfolio.html" },
  { id: "transactions", label: "History", href: "transactions.html" },
  { id: "account", label: "Create Account", href: "create-account.html" },
  { id: "admin", label: "Admin: Create Stock", href: "create-stock.html" },
  { id: "market", label: "Admin: Market Hours", href: "market-hours.html" },
];

function renderNav(activeId) {
  const mount = document.getElementById("site-nav");
  if (!mount) return;

  const linkHtml = NAV_LINKS.map(link => {
    const activeClass = link.id === activeId ? " active" : "";
    return `<a class="${activeClass.trim()}" href="${link.href}">${link.label}</a>`;
  }).join("");

  // getCurrentUser() lives in api.js, which every page loads before
  // calling renderNav() — see the <script> order at the bottom of
  // each page.
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const sessionHtml = user
    ? `<span class="session-user">Logged in as <strong>${user.username}</strong></span>
       <a href="#" id="logout-link">Log Out</a>`
    : `<a href="login.html"${activeId === "login" ? ' class="active"' : ""}>Log In</a>`;

  mount.innerHTML = `
    <header class="site-header">
      <div class="nav-inner">
        <div class="brand">StockSim</div>
        <nav class="links">${linkHtml}${sessionHtml}</nav>
      </div>
    </header>
  `;

  const logoutLink = document.getElementById("logout-link");
  if (logoutLink) {
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      logout().then(() => window.location.reload());
    });
  }
}

// ---------------------------------------------------------
// Call this at the top of any page whose real endpoint requires
// a session per the contract — Buy, Sell, Deposit/Withdraw.
// Returns true if logged in (page should render normally).
// Returns false and replaces <main> with a "please log in" message
// if not — the calling page's script should skip its own setup
// in that case (wrap it in `if (requireLogin()) { ... }`).
// ---------------------------------------------------------
function requireLogin() {
  if (getCurrentUser()) return true;

  const main = document.querySelector("main");
  if (main) {
    main.innerHTML = `
      <h1>Log In Required</h1>
      <p class="page-sub">You need to be logged in to use this page.</p>
      <div class="stub">
        <a href="login.html">Log in</a> or <a href="create-account.html">create an account</a> to continue.
      </div>
    `;
  }
  return false;
}

// ---------------------------------------------------------
// Same idea as requireLogin(), but for admin-only pages
// (Create Stock, Market Hours) per the contract's (admin) tag.
// Admin accounts are real now: the user's role comes from the database
// (a local test admin can be made with one SQL UPDATE on users.role).
// ---------------------------------------------------------
function requireAdmin() {
  const user = getCurrentUser();
  if (!user) return requireLogin();

  if (user.role !== "admin") {
    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `
        <h1>Admin Access Required</h1>
        <p class="page-sub">This page is for administrators only.</p>
        <div class="stub">
          Logged in as <strong>${user.username}</strong>, a ${user.role} account.
          Log in as an admin to continue.
        </div>
      `;
    }
    return false;
  }
  return true;
}

// ---------------------------------------------------------
// Shared small helpers
// ---------------------------------------------------------
function fmtMoney(n) {
  return n === null || n === undefined ? "—" : "$" + Number(n).toFixed(2);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------------------------------------------------------
// Orders panel, used by both Buy and Sell.
//
// Shows this user's PENDING orders (with a live countdown and a Cancel
// button) and their most recent finished orders (executed, rejected
// or canceled, with the reason). The list comes from GET /orders; it's
// re-fetched every 2 seconds, and the countdown redraws twice a second
// from the last fetch.
//
//   pendingEl, recentEl   the two boxes to fill
//   options.onUpdate(orders)   called after every fetch
//   options.onMessage(text, type)   called when a cancel fails
// Returns { reload } so a page can refresh right after placing an order.
// ---------------------------------------------------------
function startOrdersPanel(pendingEl, recentEl, options = {}) {
  let orders = [];

  function orderLine(o) {
    const what = `${o.orderType.toUpperCase()} ${o.quantity} ${escapeHtml(o.ticker)}`;
    if (o.status === "executed") {
      return `<div class="order-row order-executed">✓ ${what} at ${fmtMoney(o.executedPrice)} = ${fmtMoney(o.totalAmount)}</div>`;
    }
    if (o.status === "rejected") {
      return `<div class="order-row order-rejected">✕ ${what} was rejected: ${escapeHtml(o.rejectReason || "unknown reason")}</div>`;
    }
    return `<div class="order-row order-canceled">${what} was canceled</div>`;
  }

  function render() {
    const pending = orders.filter(o => o.status === "pending");
    const recent = orders.filter(o => o.status !== "pending").slice(0, 5);

    pendingEl.innerHTML = pending.length === 0
      ? `<p class="muted-note">No pending orders.</p>`
      : pending.map(o => {
          const secs = Math.max(0, Math.ceil((o.executesAt - Date.now()) / 1000));
          const when = secs > 0 ? `executes in ${secs}s` : "processing…";
          return `
            <div class="pending-row">
              <span>${escapeHtml(o.ticker)} · ${o.quantity} shares · ${o.orderType.toUpperCase()} · ${when}</span>
              <button class="btn secondary small" data-cancel="${o.orderId}">Cancel</button>
            </div>`;
        }).join("");

    recentEl.innerHTML = recent.length === 0
      ? `<p class="muted-note">No completed orders yet.</p>`
      : recent.map(orderLine).join("");
  }

  function reload() {
    return getOrders().then(res => {
      if (res.success) {
        orders = res.orders;
        render();
        if (options.onUpdate) options.onUpdate(orders);
      }
    });
  }

  pendingEl.addEventListener("click", (e) => {
    const id = e.target.getAttribute("data-cancel");
    if (!id) return;
    e.target.disabled = true;
    cancelOrder(Number(id)).then(res => {
      if (!res.success && options.onMessage) options.onMessage(res.error, "error");
      reload();
    });
  });

  reload();
  setInterval(reload, 2000);
  setInterval(render, 500);
  return { reload };
}
