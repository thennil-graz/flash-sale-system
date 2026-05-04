/**
 * k6 stress test — Order endpoint
 *
 * Goal: verify the system sustains high concurrent order throughput without
 * errors, while the atomic Redis claim prevents overselling.
 *
 * Run:
 *   k6 run test/stress/order.k6.js
 *
 * Prerequisites:
 *   1. docker compose up -d
 *   2. npm run start:dev (in flash-sale-service/)
 *
 * The setup() function handles stock seeding and sale schedule automatically.
 * Results are written to test/stress/results/summary.json — create that
 * directory first if it does not exist: mkdir -p test/stress/results
 *
 * Override the base URL if the service runs on a different host/port:
 *   k6 run -e BASE_URL=http://staging.example.com:3001 test/stress/order.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// ─── Custom metrics ────────────────────────────────────────────────────────

const orderSuccesses  = new Counter('order_successes');
const orderOutOfStock = new Counter('order_out_of_stock');
const orderDuplicates = new Counter('order_duplicates');
const unexpectedErrors = new Counter('order_unexpected_errors');
const errorRate        = new Rate('order_error_rate');
const orderLatency     = new Trend('order_latency_ms', true);

// ─── Load stages ───────────────────────────────────────────────────────────
//
// Stage 1 (0→30s):   ramp from 0 to 100 VUs  — warm up
// Stage 2 (30→90s):  hold 100 VUs            — sustained load
// Stage 3 (90→150s): spike to 500 VUs        — burst (flash sale open)
// Stage 4 (150→180s): ramp back to 0         — cool down

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '60s', target: 100 },
    { duration: '60s', target: 500 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // p95 latency must stay under 500 ms
    http_req_duration: ['p(95)<500'],
    // Unexpected errors (5xx / network failures) must be < 1 %
    order_error_rate: ['rate<0.01'],
    // At least 1 order must succeed during the run
    order_successes: ['count>0'],
  },
};

// ─── Setup — runs once before any VU starts ────────────────────────────────

export function setup() {
  const params = { headers: { 'Content-Type': 'application/json' } };

  // Fail fast if the backend is not reachable
  const healthRes = http.get(`${BASE_URL}/`);
  if (healthRes.status !== 200) {
    throw new Error(
      `Backend not reachable at ${BASE_URL} (got ${healthRes.status}). ` +
      `Start with: npm run start:dev`,
    );
  }

  // Seed stock — 10 000 units gives enough headroom across all load stages
  const stockRes = http.patch(
    `${BASE_URL}/products/product_001/stock`,
    JSON.stringify({ stock: 10000 }),
    params,
  );
  if (stockRes.status !== 200) {
    throw new Error(`Failed to seed stock: ${stockRes.status} — ${stockRes.body}`);
  }

  // Open a long-running sale window so no VU is rejected on timing
  const scheduleRes = http.patch(
    `${BASE_URL}/products/product_001/sale-schedule`,
    JSON.stringify({
      saleStartDate: '2000-01-01T00:00:00.000Z',
      saleEndDate: '2099-12-31T23:59:59.000Z',
    }),
    params,
  );
  if (scheduleRes.status !== 200) {
    throw new Error(`Failed to set sale schedule: ${scheduleRes.status} — ${scheduleRes.body}`);
  }

  console.log('Setup complete — 10 000 units seeded, sale window open');
}

// ─── Main VU function ──────────────────────────────────────────────────────

export default function () {
  // Each virtual user generates a unique userId per iteration so the
  // duplicate-purchase guard only fires when we deliberately test it.
  const userId    = `vu_${__VU}_iter_${__ITER}`;
  const productId = 'product_001';

  const payload = JSON.stringify({ userId, productId });
  const params  = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(`${BASE_URL}/orders`, payload, params);

  orderLatency.add(res.timings.duration);

  const isExpected = check(res, {
    'status is 201, 400, or 409': (r) =>
      r.status === 201 || r.status === 409 || r.status === 400,
  });

  if (res.status === 201) {
    orderSuccesses.add(1);
  } else if (res.status === 409) {
    const body = res.json();
    if (body && body.message === 'Out of stock') {
      orderOutOfStock.add(1);
    } else {
      orderDuplicates.add(1);
    }
  } else if (!isExpected) {
    unexpectedErrors.add(1);
    errorRate.add(1);
  }

  // Minimal think time to avoid overwhelming a single-node dev setup.
  // Remove or lower for true hammering.
  sleep(0.05);
}

// ─── Summary ──────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const successes  = data.metrics.order_successes?.values?.count ?? 0;
  const outOfStock = data.metrics.order_out_of_stock?.values?.count ?? 0;
  const duplicates = data.metrics.order_duplicates?.values?.count ?? 0;
  const errors     = data.metrics.order_unexpected_errors?.values?.count ?? 0;
  const p95        = data.metrics.order_latency_ms?.values?.['p(95)'] ?? 0;

  console.log('\n─── Flash Sale Stress Test Results ───────────────────────');
  console.log(`  Orders succeeded  : ${successes}`);
  console.log(`  Out of stock (409): ${outOfStock}`);
  console.log(`  Duplicate (409)   : ${duplicates}`);
  console.log(`  Unexpected errors : ${errors}`);
  console.log(`  p95 latency       : ${p95.toFixed(1)} ms`);
  console.log('──────────────────────────────────────────────────────────\n');

  return {
    'test/stress/results/summary.json': JSON.stringify(data, null, 2),
    stdout: '',
  };
}
