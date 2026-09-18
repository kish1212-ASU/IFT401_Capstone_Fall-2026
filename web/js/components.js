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
  { id: "account", label: "Create Account", href: "create-account.html" },
  { id: "admin", label: "Admin: Create Stock", href: "create-stock.html" },
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
      <p class="page-sub">This action moves real money or shares, so the real backend will require a logged-in session here.</p>
      <div class="stub">
        <a href="login.html">Log in</a> or <a href="create-account.html">create an account</a> to continue.
      </div>
    `;
  }
  return false;
}
