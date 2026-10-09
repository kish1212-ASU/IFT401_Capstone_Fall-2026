-- ============================================================
-- Stock Trading System - IFT 401
-- PROPOSED SCHEMA - DRAFT for Alex to accept, edit, or replace.
-- Alex owns the data model; this exists so the local stack runs
-- and so the open questions below are visible instead of assumed.
--
-- Conventions used here:
--   * All money/price columns are NUMERIC, never float.
--     Floating point rounding on cash balances will drift.
--   * All timestamps are TIMESTAMPTZ storing UTC.
--     Market hours are stored separately as local clock time
--     plus a named timezone (see market_config).
--
-- OPEN QUESTIONS (see docs/open-questions.md):
--   Q1. VOLUME: business case says volume = "total amount of shares
--       purchased" and market cap = volume x price. Is volume a static
--       value the admin sets at stock creation, or a running counter the
--       trade logic increments on every buy? Modeled as static below.
--   Q2. DAILY PRICE FIELDS: opening_price / day_high / day_low are not
--       in the submitted ERD, but the business case requires displaying
--       them. Modeled as columns on stocks that reset at market open.
--       Alternative is a separate daily_price table keeping history.
-- ============================================================

DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS holdings CASCADE;
DROP TABLE IF EXISTS stocks CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS market_config CASCADE;

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
CREATE TABLE users (
    user_id         SERIAL PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL UNIQUE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    full_name       VARCHAR(150) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20)  NOT NULL DEFAULT 'customer',
    cash_balance    NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_role  CHECK (role IN ('customer','admin')),
    CONSTRAINT chk_users_cash  CHECK (cash_balance >= 0)
);

-- ------------------------------------------------------------
-- STOCKS
-- current_price is written by the Random Stock Price Generator.
-- ------------------------------------------------------------
CREATE TABLE stocks (
    stock_id        SERIAL PRIMARY KEY,
    ticker          VARCHAR(10)  NOT NULL UNIQUE,
    company_name    VARCHAR(150) NOT NULL,
    initial_price   NUMERIC(14,4) NOT NULL,
    current_price   NUMERIC(14,4) NOT NULL,
    opening_price   NUMERIC(14,4),          -- Q2: resets at market open
    day_high        NUMERIC(14,4),          -- Q2
    day_low         NUMERIC(14,4),          -- Q2
    volume          BIGINT       NOT NULL DEFAULT 0,  -- Q1: static or running?
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stocks_price   CHECK (current_price > 0),
    CONSTRAINT chk_stocks_volume  CHECK (volume >= 0)
);

CREATE INDEX idx_stocks_ticker ON stocks(ticker);

-- ------------------------------------------------------------
-- HOLDINGS - what a user currently owns
-- ------------------------------------------------------------
CREATE TABLE holdings (
    holding_id      SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id)  ON DELETE CASCADE,
    stock_id        INT NOT NULL REFERENCES stocks(stock_id) ON DELETE RESTRICT,
    quantity        INT NOT NULL,
    avg_cost_basis  NUMERIC(14,4) NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_holdings_user_stock UNIQUE (user_id, stock_id),
    CONSTRAINT chk_holdings_qty CHECK (quantity >= 0)
);

-- ------------------------------------------------------------
-- ORDERS - buy/sell requests, cancellable while pending
-- ------------------------------------------------------------
CREATE TABLE orders (
    order_id        SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id)   ON DELETE CASCADE,
    stock_id        INT NOT NULL REFERENCES stocks(stock_id) ON DELETE RESTRICT,
    order_type      VARCHAR(10) NOT NULL,
    quantity        INT         NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'pending',
    requested_price NUMERIC(14,4),
    executed_price  NUMERIC(14,4),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at     TIMESTAMPTZ,
    canceled_at     TIMESTAMPTZ,
    executes_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reject_reason   VARCHAR(100),
    CONSTRAINT chk_orders_type   CHECK (order_type IN ('buy','sell')),
    CONSTRAINT chk_orders_status CHECK (status IN ('pending','executed','canceled','rejected')),
    CONSTRAINT chk_orders_qty    CHECK (quantity > 0)
);

CREATE INDEX idx_orders_user_status ON orders(user_id, status);

-- ------------------------------------------------------------
-- TRANSACTIONS - completed financial activity
-- stock_id is NULL for deposits and withdrawals.
-- ------------------------------------------------------------
CREATE TABLE transactions (
    transaction_id   SERIAL PRIMARY KEY,
    user_id          INT NOT NULL REFERENCES users(user_id)   ON DELETE CASCADE,
    stock_id         INT     REFERENCES stocks(stock_id)      ON DELETE RESTRICT,
    order_id         INT     REFERENCES orders(order_id)      ON DELETE SET NULL,
    transaction_type VARCHAR(12) NOT NULL,
    quantity         INT,
    price_per_share  NUMERIC(14,4),
    total_amount     NUMERIC(14,2) NOT NULL,
    balance_after    NUMERIC(14,2) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_txn_type CHECK (transaction_type IN ('buy','sell','deposit','withdrawal'))
);

CREATE INDEX idx_transactions_user ON transactions(user_id, created_at DESC);

-- ------------------------------------------------------------
-- MARKET_CONFIG - single platform-level row (id = 1)
-- Hours stored as local clock time + named timezone so that
-- "is the market open right now" is unambiguous across DST.
-- ------------------------------------------------------------
CREATE TABLE market_config (
    config_id       INT PRIMARY KEY DEFAULT 1,
    market_open     TIME        NOT NULL DEFAULT '09:30',
    market_close    TIME        NOT NULL DEFAULT '16:00',
    timezone        VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
    trading_days    VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5', -- ISO: 1=Mon
    holidays        DATE[]      NOT NULL DEFAULT '{}',
    is_open_override BOOLEAN,   -- NULL = follow schedule; TRUE/FALSE = force
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_config_single CHECK (config_id = 1),
    CONSTRAINT chk_config_hours  CHECK (market_close > market_open)
);
