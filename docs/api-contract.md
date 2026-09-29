# API Contract - Stock Trading System

Draft. This is the interface between the frontend and the API. If you need
something changed, say so here or in Discord rather than working around it,
since we're all building against this.

Base URL in local dev: `http://localhost:3000`

Two things still open, both flagged inline below:

- **Volume.** Business case says volume is total shares purchased and market
  cap is volume times price. Unclear if it's static (admin sets it once) or a
  running counter the trade logic increments. The field exists either way, so
  this doesn't change the shape of any response.
- **Daily price fields.** `opening_price`, `day_high`, `day_low` may come from
  columns on `stocks` or a separate daily table. Either way the JSON keys stay
  the same.

## Conventions

All request and response bodies are JSON. Money and prices come back as
strings, not numbers, because they're `NUMERIC` in Postgres and JavaScript
floats will mangle them. Parse them with care on the frontend.

Timestamps are ISO 8601 in UTC, e.g. `2026-09-16T14:30:00.000Z`.

Errors all use the same shape:

    { "error": "Human readable message" }

Status codes used:

    200  success
    201  created
    400  bad request (validation failed)
    401  not logged in
    403  logged in but not allowed (e.g. customer hitting an admin route)
    404  not found
    409  conflict (market closed, insufficient funds, duplicate username)
    500  server error

Auth is token based (JWT). `POST /auth/login` returns a `token`, and the
client sends it on every request to a route marked (auth) or (admin):

    Authorization: Bearer <token>

Routes marked (auth) require a valid token. Routes marked (admin) require a
valid token whose user has `role = 'admin'`. A missing, invalid, or expired
token returns 401. A valid token with the wrong role returns 403.

Server side, this is a small middleware that reads the header, verifies the
token, and attaches the user to the request, plus a role check on admin
routes. Signing secret lives in `.env`, never in the repo. Tokens expire after
a few hours. There is no sessions table. The frontend runs on a different
origin than the API, so tokens also avoid the cookie and CORS-credentials
setup; the default `cors()` allows the Authorization header, but test it.

---

## Health

### GET /health

No auth. Returns ok only if the API can reach the database.

    200
    { "status": "ok", "database": "connected" }

    503
    { "status": "error", "database": "unreachable" }

---

## Accounts

### POST /users

Create a customer account. Business case requires full name, username, email.

    Request
    {
      "username": "jdoe",
      "email": "jdoe@example.com",
      "full_name": "Jane Doe",
      "password": "..."
    }

    201
    {
      "user_id": 3,
      "username": "jdoe",
      "email": "jdoe@example.com",
      "full_name": "Jane Doe",
      "role": "customer",
      "cash_balance": "0.00",
      "created_at": "2026-09-16T14:30:00.000Z"
    }

    400  missing or invalid field
    409  username or email already taken

Never returns `password_hash`. New accounts start at 0.00 cash.

### POST /auth/login

    Request
    { "username": "jdoe", "password": "..." }

    200
    {
      "user_id": 3,
      "username": "jdoe",
      "role": "customer",
      "token": "eyJhbGciOi..."
    }

    401  bad credentials

The token payload carries `user_id` and `role`. The frontend stores the token
and sends it as a Bearer header on every (auth) and (admin) request.

### POST /auth/logout  (auth)

    204  no body

Tokens are stateless, so the server does nothing here. The client discards
its token. The route exists so the frontend has one call to make on logout.

### GET /users/me  (auth)

Current user including cash balance. Same shape as the POST /users response.

---

## Stocks

### GET /stocks

No auth. Powers the main listing page.

    200
    [
      {
        "stock_id": 1,
        "ticker": "ACME",
        "company_name": "Acme Industrial Corp",
        "current_price": "45.7500",
        "opening_price": "45.0000",
        "day_high": "46.2000",
        "day_low": "44.8000",
        "volume": 120000,
        "market_cap": "5490000.0000"
      }
    ]

`market_cap` is computed as volume x current_price. Not stored.

Only active stocks. Sorted by ticker.

OPEN: whether `volume` changes after trades.
OPEN: where the three daily price fields come from.

### GET /stocks/:id

Single stock, same object shape as above.

    404  no such stock

---

## Orders

Orders are not executed instantly. `POST /orders` creates a pending order, and
a background executor on the server fills it a few seconds later. That window
is what lets a customer cancel before execution, per the business case.

Statuses: `pending`, `executed`, `canceled`, `rejected`.

Cash and shares are not reserved while an order is pending. Funds, shares,
market hours, and price are all checked when the order executes, not when it
is placed. If any check fails at that point the order becomes `rejected`.

### POST /orders  (auth)

Place a buy or sell at market price.

    Request
    { "stock_id": 1, "order_type": "buy", "quantity": 10 }

    201
    {
      "order_id": 12,
      "stock_id": 1,
      "ticker": "ACME",
      "order_type": "buy",
      "quantity": 10,
      "status": "pending",
      "executes_at": "2026-09-16T14:30:08.000Z",
      "executed_price": null,
      "total_amount": null,
      "reject_reason": null,
      "created_at": "2026-09-16T14:30:00.000Z",
      "executed_at": null,
      "canceled_at": null
    }

    400  quantity not a positive integer
    404  stock not found
    409  market closed

Only the market-closed check happens at placement. Funds and shares are
checked at execution. Never trust a price sent by the client, the price is
read by the server when the order executes.

### GET /orders  (auth)

Current user's orders, newest first. Optional `?status=pending` (or any of the
four statuses).

    200
    [ { ...order object... } ]

Clients can poll this or `GET /orders/:id` to see when a pending order
becomes `executed` or `rejected`.

### GET /orders/:id  (auth)

Single order, same shape as above.

    403  not your order
    404  no such order

### DELETE /orders/:id  (auth)

Cancel a pending order. Business case requires this.

    200
    { "order_id": 12, "status": "canceled", "canceled_at": "..." }

    403  not your order
    404  no such order
    409  already executed, rejected, or canceled

### Order executor (server side, not an HTTP route)

A timer inside the API (`setInterval`, every 1 to 2 seconds) finds pending
orders where `executes_at <= now()` and processes each one in its own database
transaction:

1. Lock the row (`SELECT ... FOR UPDATE SKIP LOCKED`) so two runs never
   process the same order.
2. Re-check the market is open. If not, mark `rejected`, reason
   `market closed`.
3. Read the stock's current price.
4. Buy: check cash covers quantity x price. Sell: check the user holds enough
   shares. If not, mark `rejected` with reason `insufficient funds` or
   `insufficient shares`.
5. Otherwise write the transaction row, update the holding and cash balance,
   and mark the order `executed` with `executed_price`, `total_amount`, and
   `executed_at`.

Cancel must be race-safe against the executor. `DELETE` should do
`UPDATE orders SET status = 'canceled', canceled_at = now() WHERE order_id = $1
AND status = 'pending'` and return 409 if zero rows changed.

---

## Cash

### POST /cash/deposit  (auth)

    Request
    { "amount": "500.00" }

    201
    {
      "transaction_id": 44,
      "transaction_type": "deposit",
      "total_amount": "500.00",
      "balance_after": "10500.00",
      "created_at": "..."
    }

    400  amount missing, zero, or negative

### POST /cash/withdraw  (auth)

Same request and response shape, `transaction_type` is `withdrawal`.

    409  insufficient funds

Withdrawals only come out of the cash account, per the business case.

---

## Portfolio

### GET /portfolio  (auth)

Holdings plus cash, for the portfolio page.

    200
    {
      "cash_balance": "10500.00",
      "holdings_value": "1830.00",
      "total_value": "12330.00",
      "holdings": [
        {
          "stock_id": 1,
          "ticker": "ACME",
          "company_name": "Acme Industrial Corp",
          "quantity": 40,
          "avg_cost_basis": "44.2500",
          "current_price": "45.7500",
          "market_value": "1830.00",
          "gain_loss": "60.00"
        }
      ]
    }

Values are computed at request time off current price, not stored.

Zero-quantity holdings are excluded.

### GET /transactions  (auth)

Full history, newest first. Buys, sells, deposits, withdrawals.

    200
    [
      {
        "transaction_id": 44,
        "transaction_type": "buy",
        "ticker": "ACME",
        "quantity": 10,
        "price_per_share": "45.7500",
        "total_amount": "457.50",
        "balance_after": "10042.50",
        "created_at": "..."
      }
    ]

`ticker`, `quantity`, and `price_per_share` are null for deposits and
withdrawals.

---

## Admin

### POST /stocks  (admin)

Create a stock. Business case: company name, ticker, volume, initial price.

    Request
    {
      "ticker": "NEWC",
      "company_name": "New Company Inc",
      "initial_price": "50.00",
      "volume": 100000
    }

    201  same shape as GET /stocks/:id

    400  invalid field
    403  not an admin
    409  ticker already exists

`current_price` is set to `initial_price` on creation.

### PATCH /stocks/:id  (admin)

Update company name or active status. Does not set price directly, that's the
generator's job.

### GET /market  (no auth)

Market status and hours. The listing page needs this for the open/closed
indicator.

    200
    {
      "is_open": true,
      "market_open": "09:30",
      "market_close": "16:00",
      "timezone": "America/New_York",
      "trading_days": [1,2,3,4,5],
      "holidays": ["2026-11-26","2026-12-25"],
      "server_time": "2026-09-16T14:30:00.000Z"
    }

`is_open` is computed server-side from hours, weekday, and holidays. The
frontend should display it, not calculate it.

`trading_days` uses ISO weekday numbers, 1 = Monday.

### PUT /market  (admin)

Change hours and schedule.

    Request
    {
      "market_open": "09:00",
      "market_close": "16:30",
      "timezone": "America/New_York",
      "trading_days": [1,2,3,4,5],
      "holidays": ["2026-11-26","2026-12-25"]
    }

    200  same shape as GET /market
    400  close time not after open time
    403  not an admin

Validation matches the decision diamond in the Change Market Hours process map.

---

## Notes for the price generator

The generator is a scheduled background job, not an HTTP route. It writes
directly to the database rather than going through the API.

On each cycle it checks whether the market is open, and if so nudges every
active stock's `current_price` by a small random amount, then updates
`day_high` and `day_low` if the new price exceeds either. At market open it
sets `opening_price` to the current price and resets the daily high and low.

Prices are never allowed to go to zero or negative.

If we'd rather the generator go through an authenticated internal endpoint
instead of writing straight to the tables, say so, since that affects whether
the trade logic and the generator are both writing the same rows.
