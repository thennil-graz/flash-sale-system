-- ─────────────────────────────────────────
-- Flash Sale System Schema
-- ─────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS flashsale;
USE flashsale;

-- ─────────────────────────────────────────
-- Products (single product, limited stock)
-- ─────────────────────────────────────────
CREATE TABLE products (
  id          VARCHAR(36)     NOT NULL PRIMARY KEY,
  name        VARCHAR(255)    NOT NULL,
  description TEXT            NULL,
  stock       INT UNSIGNED    NOT NULL DEFAULT 0,  -- source of truth for reconciliation
  price       DECIMAL(10, 2)  NOT NULL,
  sale_start_date DATETIME        NULL,
  sale_end_date   DATETIME        NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─────────────────────────────────────────
-- Orders
-- Status flow: PENDING → SUCCESS | FAILED
-- ─────────────────────────────────────────
CREATE TABLE orders (
  id              VARCHAR(36)     NOT NULL PRIMARY KEY,  -- idempotency key
  user_id         VARCHAR(36)     NOT NULL,
  product_id      VARCHAR(36)     NOT NULL,
  status          ENUM('PENDING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
  event_published TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- one order per user per product (enforced at DB level as a safety net)
  UNIQUE KEY uq_user_product (user_id, product_id),

  CONSTRAINT fk_order_product FOREIGN KEY (product_id) REFERENCES products(id),

  -- composite index for the sweeper query: PENDING + event_published = 0
  INDEX idx_unpublished (status, event_published),
  INDEX idx_user_id     (user_id),
  INDEX idx_created_at  (created_at)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────
-- Dead Letter Queue log (INVENTORY_DLQ, PAYMENT_DLQ)
-- Persists failed Kafka messages for manual retry / reconciliation job
-- ─────────────────────────────────────────
CREATE TABLE dead_letter_queue (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  topic        VARCHAR(255)     NOT NULL,  -- e.g. 'ORDER_CREATED', 'PAYMENT_RESULT_FAILED'
  partition    INT              NOT NULL,
  kafka_offset BIGINT           NOT NULL,
  payload      JSON             NOT NULL,
  error        TEXT             NOT NULL,
  retry_count  INT UNSIGNED     NOT NULL DEFAULT 0,
  resolved     TINYINT(1)       NOT NULL DEFAULT 0,
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_topic      (topic),
  INDEX idx_resolved   (resolved),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────
-- Seed: one flash sale product (3,000,000 units)
-- Stock in Redis is the live counter;
-- this is the source of truth for reconciliation.
-- ─────────────────────────────────────────
INSERT INTO products (id, name, description, stock, price, sale_start_date, sale_end_date)
VALUES ('product_001', 'Flash Sale Item', 'Limited-edition item. Grab yours before stock runs out — once it\'s gone, it\'s gone!', 3000000, 99.99, '2026-04-30 16:00:00', '2026-05-03 00:59:59');