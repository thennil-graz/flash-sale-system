-- ─────────────────────────────────────────
-- Seed: one flash sale product (3,000,000 units)
-- Stock in Redis is the live counter;
-- this is the source of truth for reconciliation.
-- ─────────────────────────────────────────
INSERT INTO products (id, name, description, stock, price, sale_start_date, sale_end_date)
VALUES ('product_001', 'Flash Sale Item', 'Limited-edition item. Grab yours before stock runs out — once it\'s gone, it\'s gone!', 3000000, 99.99, '2026-04-30 16:00:00', '2026-05-03 00:59:59');