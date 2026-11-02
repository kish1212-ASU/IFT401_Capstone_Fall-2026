-- ============================================================
-- Seed data for local development only.
-- Not for deployment. Prices are invented.
-- ============================================================

INSERT INTO market_config (config_id) VALUES (1);

INSERT INTO stocks (ticker, company_name, initial_price, current_price,
                    opening_price, day_high, day_low, volume) VALUES
  ('ACME', 'Acme Industrial Corp',     45.00,  45.75,  45.00,  46.20,  44.80,  120000),
  ('BRVO', 'Bravo Logistics Inc',     112.50, 110.25, 112.50, 113.10, 109.90,   85000),
  ('CDNT', 'Cadent Software',          78.25,  79.90,  78.25,  80.40,  77.95,  240000),
  ('DELT', 'Delta Ridge Energy',       23.10,  22.65,  23.10,  23.40,  22.50,  310000),
  ('ECHO', 'Echo Health Systems',     156.00, 158.30, 156.00, 159.75, 155.20,   62000),
  ('FLUX', 'Fluxwave Semiconductor',   94.40,  97.15,  94.40,  97.80,  94.10,  198000),
  ('GRNT', 'Granite Financial Group',  61.75,  60.40,  61.75,  62.00,  60.10,  140000),
  ('HLIO', 'Helio Renewables',         18.90,  19.55,  18.90,  19.70,  18.75,  420000);

-- Test accounts. Password hashes are placeholders until auth is built.
INSERT INTO users (username, email, full_name, password_hash, role, cash_balance) VALUES
  ('admin',   'admin@example.com',   'System Administrator', '$2b$10$2Pgizs63X38MHi94WaCILObHbwQ9yleAg8JK1sSCMk.Z/GvVTIml2', 'admin',    0.00),
  ('testuser','customer@example.com','Test Customer',        '$2b$10$2Pgizs63X38MHi94WaCILObHbwQ9yleAg8JK1sSCMk.Z/GvVTIml2', 'customer', 10000.00);
