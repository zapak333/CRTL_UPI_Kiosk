-- CRTL Canteen Kiosk: initial schema
-- Money is stored as NUMERIC(12,2) (rupees). Application code converts to integer paise for arithmetic.
-- Historical sales data is protected: order_items keep a snapshot of name/price, and food items /
-- categories referenced by orders are soft-deleted (deleted_at) rather than removed.

CREATE TABLE admin_users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(64)  NOT NULL UNIQUE,
  full_name       VARCHAR(120) NOT NULL DEFAULT '',
  password_hash   VARCHAR(200) NOT NULL,
  role            VARCHAR(20)  NOT NULL CHECK (role IN ('superadmin','admin','staff')),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  failed_attempts INTEGER      NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE food_categories (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(80)  NOT NULL,
  image_url      VARCHAR(500),
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX food_categories_name_uq ON food_categories (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE food_items (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(120)  NOT NULL,
  description          VARCHAR(500)  NOT NULL DEFAULT '',
  category_id          INTEGER       NOT NULL REFERENCES food_categories(id),
  image_url            VARCHAR(500),
  price                NUMERIC(12,2) NOT NULL CHECK (price > 0),
  -- available: shown & orderable; temporarily_unavailable: shown greyed out; disabled: hidden
  availability_status  VARCHAR(30)   NOT NULL DEFAULT 'available'
                       CHECK (availability_status IN ('available','temporarily_unavailable','disabled')),
  display_order        INTEGER       NOT NULL DEFAULT 0,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX food_items_category_idx ON food_items (category_id);

-- One row per IST business date; row-locked when issuing a token so tokens never collide.
CREATE TABLE token_counters (
  business_date DATE PRIMARY KEY,
  last_token    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id               BIGSERIAL PRIMARY KEY,
  order_number     VARCHAR(30)   NOT NULL UNIQUE,          -- human readable, e.g. CRTL-20261125-000042
  idempotency_key  VARCHAR(80)   NOT NULL UNIQUE,          -- sent by kiosk, prevents duplicate orders on double-tap/retry
  access_key       VARCHAR(64)   NOT NULL,                 -- random secret the kiosk must present to pay/poll/cancel this order
  business_date    DATE          NOT NULL,                 -- IST date the order was created
  token_number     INTEGER,                                -- daily token, assigned only when payment is verified
  status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING_PAYMENT'
                   CHECK (status IN ('PENDING_PAYMENT','PAID','CANCELLED','EXPIRED','REFUNDED','PARTIALLY_REFUNDED')),
  subtotal_amount  NUMERIC(12,2) NOT NULL CHECK (subtotal_amount >= 0),
  tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount     NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  tax_label        VARCHAR(40),
  tax_rate         NUMERIC(5,2),
  currency         CHAR(3)       NOT NULL DEFAULT 'INR',
  payment_mode     VARCHAR(20)   NOT NULL DEFAULT 'UPI',
  print_status     VARCHAR(20)   NOT NULL DEFAULT 'NOT_PRINTED'
                   CHECK (print_status IN ('NOT_PRINTED','PENDING','PRINTED','FAILED')),
  needs_attention  BOOLEAN       NOT NULL DEFAULT FALSE,   -- e.g. payment received after cancellation (refund needed)
  attention_note   VARCHAR(300),
  kiosk_id         VARCHAR(60),
  paid_at          TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_daily_token_uq ON orders (business_date, token_number) WHERE token_number IS NOT NULL;
CREATE INDEX orders_business_date_idx ON orders (business_date);
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE order_items (
  id             BIGSERIAL PRIMARY KEY,
  order_id       BIGINT        NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  food_item_id   INTEGER       REFERENCES food_items(id) ON DELETE RESTRICT,
  -- Snapshot at time of purchase (never changes when the menu changes)
  item_name      VARCHAR(120)  NOT NULL,
  category_name  VARCHAR(80)   NOT NULL DEFAULT '',
  unit_price     NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),
  quantity       INTEGER       NOT NULL CHECK (quantity > 0 AND quantity <= 50),
  line_total     NUMERIC(12,2) NOT NULL CHECK (line_total > 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- One row per payment attempt. An order may have several attempts (retry after failure/expiry),
-- but at most one can ever be SUCCESS (partial unique index below).
CREATE TABLE payments (
  id                   BIGSERIAL PRIMARY KEY,
  order_id             BIGINT        NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  attempt_ref          VARCHAR(60)   NOT NULL UNIQUE,      -- our unique transaction reference sent to the provider
  provider             VARCHAR(20)   NOT NULL,             -- simulated | razorpay
  provider_order_ref   VARCHAR(100),                       -- e.g. Razorpay QR code id
  provider_payment_ref VARCHAR(100),                       -- e.g. Razorpay payment id (pay_xxx)
  bank_rrn             VARCHAR(60),                        -- UPI RRN / UTR if provided
  payer_vpa_masked     VARCHAR(100),
  amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  amount_received      NUMERIC(12,2),
  currency             CHAR(3)       NOT NULL DEFAULT 'INR',
  status               VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED','REFUNDED','PARTIALLY_REFUNDED')),
  failure_reason       VARCHAR(300),
  qr_payload           TEXT,
  qr_image_url         VARCHAR(500),
  expires_at           TIMESTAMPTZ,
  verified_via         VARCHAR(20),                         -- webhook | api_poll
  verified_at          TIMESTAMPTZ,
  last_polled_at       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE UNIQUE INDEX payments_provider_payment_uq ON payments (provider, provider_payment_ref) WHERE provider_payment_ref IS NOT NULL;

-- Every webhook / status event received from a provider, verified or not. Full audit trail + dedupe.
CREATE TABLE payment_events (
  id                BIGSERIAL PRIMARY KEY,
  provider          VARCHAR(20)  NOT NULL,
  provider_event_id VARCHAR(120),
  event_type        VARCHAR(60)  NOT NULL,
  payment_id        BIGINT       REFERENCES payments(id),
  signature_valid   BOOLEAN      NOT NULL,
  processing_result VARCHAR(60)  NOT NULL DEFAULT 'received',
  payload           JSONB        NOT NULL,
  received_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_events_dedupe_uq ON payment_events (provider, provider_event_id) WHERE provider_event_id IS NOT NULL AND signature_valid;

CREATE TABLE refunds (
  id                  BIGSERIAL PRIMARY KEY,
  payment_id          BIGINT        NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  order_id            BIGINT        NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason              VARCHAR(300)  NOT NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  provider_refund_ref VARCHAR(100),
  failure_reason      VARCHAR(300),
  requested_by        INTEGER       REFERENCES admin_users(id),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX refunds_order_idx ON refunds (order_id);

CREATE TABLE print_jobs (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT       REFERENCES orders(id) ON DELETE RESTRICT,
  kind          VARCHAR(20)  NOT NULL CHECK (kind IN ('ORIGINAL','REPRINT','TEST')),
  status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PRINTING','PRINTED','FAILED')),
  attempts      INTEGER      NOT NULL DEFAULT 0,
  last_error    VARCHAR(500),
  requested_by  INTEGER      REFERENCES admin_users(id),
  printed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Exactly one automatic (original) ticket per order: duplicate webhooks can never print twice.
CREATE UNIQUE INDEX print_jobs_one_original_uq ON print_jobs (order_id) WHERE kind = 'ORIGINAL';

CREATE TABLE daily_reports (
  id                    SERIAL PRIMARY KEY,
  report_date           DATE          NOT NULL UNIQUE,
  total_orders          INTEGER       NOT NULL,
  total_items_sold      INTEGER       NOT NULL,
  successful_txns       INTEGER       NOT NULL,
  total_collection      NUMERIC(12,2) NOT NULL,
  failed_payments       INTEGER       NOT NULL,
  pending_payments      INTEGER       NOT NULL,
  cancelled_orders      INTEGER       NOT NULL,
  total_refunds         NUMERIC(12,2) NOT NULL,
  net_collection        NUMERIC(12,2) NOT NULL,
  report_data           JSONB         NOT NULL,
  generated_by          VARCHAR(40)   NOT NULL DEFAULT 'scheduler',
  generated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE printer_settings (
  id                 INTEGER      PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- single row
  driver             VARCHAR(20)  NOT NULL DEFAULT 'mock' CHECK (driver IN ('mock','network','device')),
  network_host       VARCHAR(120),
  network_port       INTEGER      NOT NULL DEFAULT 9100,
  device_path        VARCHAR(200),                                        -- e.g. /dev/usb/lp0 or \\localhost\ThermalShare
  chars_per_line     INTEGER      NOT NULL DEFAULT 48,                    -- 80mm Font A = 48, Font B = 64
  auto_print         BOOLEAN      NOT NULL DEFAULT TRUE,
  cut_paper          BOOLEAN      NOT NULL DEFAULT TRUE,
  open_drawer        BOOLEAN      NOT NULL DEFAULT FALSE,
  check_status       BOOLEAN      NOT NULL DEFAULT TRUE,                  -- query paper/online status before printing (network)
  mock_fail          BOOLEAN      NOT NULL DEFAULT FALSE,                 -- mock driver: simulate a disconnected printer
  timeout_ms         INTEGER      NOT NULL DEFAULT 5000,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
INSERT INTO printer_settings (id) VALUES (1);

CREATE TABLE system_settings (
  key         VARCHAR(80)  PRIMARY KEY,
  value       JSONB        NOT NULL,
  updated_by  INTEGER      REFERENCES admin_users(id),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  actor_type   VARCHAR(20)  NOT NULL,            -- admin | kiosk | system | provider
  actor_id     INTEGER,
  actor_name   VARCHAR(80),
  action       VARCHAR(80)  NOT NULL,
  entity_type  VARCHAR(40),
  entity_id    VARCHAR(60),
  details      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  ip_address   VARCHAR(64),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

-- Payments, refunds and audit logs are append-only from the application's point of view:
-- block DELETE at the database level so history cannot be removed accidentally.
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Deleting rows from % is not allowed (financial/audit history)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_no_delete       BEFORE DELETE ON orders         FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER order_items_no_delete  BEFORE DELETE ON order_items    FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER payments_no_delete     BEFORE DELETE ON payments       FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER payment_events_no_del  BEFORE DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER refunds_no_delete      BEFORE DELETE ON refunds        FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER audit_logs_no_delete   BEFORE DELETE ON audit_logs     FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- A successful payment's amount/provider refs can never be edited afterwards.
CREATE OR REPLACE FUNCTION protect_completed_payment() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('SUCCESS','REFUNDED','PARTIALLY_REFUNDED') THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.amount_received IS DISTINCT FROM OLD.amount_received
       OR NEW.provider_payment_ref IS DISTINCT FROM OLD.provider_payment_ref
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.status NOT IN ('SUCCESS','REFUNDED','PARTIALLY_REFUNDED') THEN
      RAISE EXCEPTION 'Completed payment % cannot be altered; record a refund instead', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_protect_completed BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION protect_completed_payment();

-- Order line items are immutable once written.
CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER order_items_immutable BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION forbid_update();

-- Session store for admin logins (connect-pg-simple layout)
CREATE TABLE admin_sessions (
  sid    VARCHAR      NOT NULL PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX admin_sessions_expire_idx ON admin_sessions (expire);
