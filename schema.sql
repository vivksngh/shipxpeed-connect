-- Shipxpeed Connect — D1 schema

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- random opaque token
  client_id  INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS stores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  shop_domain   TEXT NOT NULL,           -- e.g. my-store.myshopify.com
  access_token  TEXT,
  scope         TEXT,
  oauth_state   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | connected
  installed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, shop_domain),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Tracks processing/fulfillment state per order (orders themselves are fetched live from Shopify)
CREATE TABLE IF NOT EXISTS order_processing (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id         INTEGER NOT NULL,
  shopify_order_id TEXT NOT NULL,
  order_number     TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | exported | shipped | fulfilled | error
  awb              TEXT,
  shipment_status  TEXT,
  exported_at      TEXT,
  fulfilled_at     TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, shopify_order_id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_stores_client ON stores(client_id);
CREATE INDEX IF NOT EXISTS idx_proc_store ON order_processing(store_id);
