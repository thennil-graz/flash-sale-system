# Flash Sale System

High-throughput flash sale system with atomic stock control, Kafka-driven order processing, and real-time SSE notifications.

## Stack

| Layer | Technology | Why | Tradeoff |
|---|---|---|---|
| Frontend | React · Vite · Styled Components | Component model fits a real-time UI with live stock and order state; Vite's HMR keeps dev fast | Heavier than plain HTML for a single-page app, but the interactivity requirement justifies it |
| Backend | Node.js · NestJS | Event-loop handles high-concurrency I/O well; NestJS gives structure (modules, DI) without inventing it yourself | NestJS adds abstraction overhead — for a pure microservice, raw Express would be leaner |
| Message Broker | Apache Kafka (KRaft, 3-broker cluster) | High throughput, durable replay, and native fan-out to multiple consumers (Inventory + Payment in parallel) | Operationally heavier than RabbitMQ or a simple queue; overkill if you only need point-to-point delivery |
| Stock gate | Redis Lua script (atomic) | Lua runs check + decrement + duplicate guard as one atomic operation — no race conditions, no overselling under burst load | Redis is in-memory; a crash before AOF flush can lose the counter. Mitigated with `appendfsync everysec` |
| Duplicate guard | Redis Set + MySQL UNIQUE constraint | Redis is the fast-path reject (microseconds); MySQL UNIQUE is the safety net if Redis is ever cold or bypassed | Two sources of truth to keep in sync; acceptable since Redis is authoritative at runtime and MySQL is the fallback |
| Order result delivery | Server-Sent Events (SSE) | Simpler than WebSockets for a one-way server-push flow; no handshake overhead, native browser support | SSE is unidirectional — fine here since the client only needs to receive the result, not send follow-up messages |
| Database | MySQL 8 | ACID guarantees for order records; `UNIQUE(user_id, product_id)` enforces no double-purchase at the DB level | Slower than Redis for hot-path reads; kept off the critical purchase path intentionally |
| Kafka mode | KRaft (no ZooKeeper) | One fewer service to run; simpler Docker Compose setup with no ZooKeeper dependency | KRaft is newer — less battle-tested than ZooKeeper-based Kafka in very large production clusters |
| Dev Infra | Docker Compose | Single command to spin up the full stack (MySQL, Redis, Kafka ×3, Kafka UI, topic init) | Not production-grade orchestration; swap for Kubernetes if scaling beyond a single host |

---

## Architecture



### Kafka Topics

| Topic | Partitions | Publisher | Consumer |
|---|---|---|---|
| `ORDER_CREATED` | 6 | Order Service | Inventory, Payment |
| `PAYMENT_RESULT_SUCCESS` | 6 | Payment Service | SSE Bridge |
| `PAYMENT_RESULT_FAILED` | 6 | Payment Service | SSE Bridge |
| `INVENTORY_DLQ` | 1 | Auto (error handler) | Manual review |
| `PAYMENT_DLQ` | 1 | Auto (error handler) | Manual review |

### Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Stock gate | Redis Lua script (atomic) | Single-operation check + decrement — no race conditions, no DB locks |
| Duplicate guard | Redis Set + MySQL UNIQUE | Redis is the fast path; DB constraint is the safety net |
| Order result delivery | Async SSE | User waits on the page; result is pushed the moment payment resolves |
| Kafka mode | KRaft (no ZooKeeper) | Simpler compose setup, no extra container |

---

## Prerequisites

- **Docker** ≥ 24 and **Docker Compose** ≥ 2
- **Node.js** ≥ 20

---

## Setup

### 1. Clone the repo

```bash
git clone <repo-url>
cd flash-sale-system
```

### 2. Configure environment variables

**Backend** — copy the example file and leave the defaults as-is (they match the Docker Compose services):

```bash
cp flash-sale-service/.env.example flash-sale-service/.env
```

`flash-sale-service/.env`:
```env
PORT=3001

KAFKA_BROKERS=localhost:29092,localhost:29093,localhost:29094

REDIS_HOST=localhost
REDIS_PORT=6379

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=appuser
MYSQL_PASSWORD=apppassword
MYSQL_DATABASE=flashsale
```

**Frontend** — create a `.env` file in `flash-sale-app/`:

```bash
echo "VITE_ORDER_SERVICE_URL=http://localhost:3001" > flash-sale-app/.env
```

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts MySQL, Redis, a 3-broker Kafka cluster, and Kafka UI. The `kafka-init` container also runs once to create all required topics, then exits.

Wait until all services are healthy (~30–60 seconds):

```bash
docker compose ps
```

All services should show `healthy` or `exited` (for `kafka-init`, which exits after topic creation).

### 4. Pre-warm Redis stock

Redis needs the stock counter seeded before orders can be placed. Run this once after the first startup:

```bash
docker exec flashsale_redis redis-cli SET stock:product_001 2000000
```

### 5. Install dependencies

```bash
cd flash-sale-service && npm install && cd ..
cd flash-sale-app && npm install && cd ..
```

### 6. Start the backend

```bash
cd flash-sale-service && npm run start:dev
```

The API will be available at `http://localhost:3001`.

### 7. Start the frontend

In a separate terminal:

```bash
cd flash-sale-app && npm run dev
```

The app will be available at `http://localhost:5173`.

---

## Services at a Glance

| Service | URL | Notes |
|---|---|---|
| React App | http://localhost:5173 | Flash sale UI |
| NestJS API | http://localhost:3001 | Order, inventory, payment, SSE |
| Kafka UI | http://localhost:8080 | Browse topics, inspect messages, monitor lag |
| MySQL | localhost:3306 | User: `appuser` / Pass: `apppassword` / DB: `flashsale` |
| Redis | localhost:6379 | No auth |

---

## Managing the Sale

### Update sale schedule

```bash
curl -X PATCH http://localhost:3001/products/product_001/sale-schedule \
  -H "Content-Type: application/json" \
  -d '{"saleStartDate": "2026-05-10T10:00:00.000Z", "saleEndDate": "2026-05-10T12:00:00.000Z"}'
```

### Update stock

```bash
curl -X PATCH http://localhost:3001/products/product_001/stock \
  -H "Content-Type: application/json" \
  -d '{"stock": 500}'
```

---

## Useful Commands

```bash
# Check container status
docker compose ps

# Open Redis CLI
docker exec -it flashsale_redis redis-cli

# Open MySQL CLI
docker exec -it flashsale_mysql mysql -u appuser -papppassword flashsale

# List Kafka topics
docker exec flashsale_kafka1 kafka-topics --bootstrap-server localhost:9092 --list

# Reset all volumes (wipes all data)
docker compose down -v
```

---

## Testing

Three test layers cover all service modules — each answering a different question.

### 1. Unit Tests

Mocks Redis, Kafka, MySQL, and the product look-up. Fast, no infrastructure needed.

```bash
cd flash-sale-service
npm run test          # run all unit tests
npm run test:cov      # with coverage report
```

**What is covered:**

| Scenario | File |
|---|---|
| Sale period validation (not started, ended, no dates, start-only) | `src/order/order.service.spec.ts` |
| Stock claim returns 0 / -1 / 1 | `src/order/order.service.spec.ts` |
| MySQL save failure → Redis revert, no Kafka emit | `src/order/order.service.spec.ts` |
| Kafka failure → eventPublished=false returned, no Redis revert | `src/order/order.service.spec.ts` |
| Sweeper: retries orders, continues on partial Kafka failure | `src/order/order.service.spec.ts` |
| findSuccessfulOrder: SUCCESS → order, PENDING / FAILED → null | `src/order/order.service.spec.ts` |
| updateStatus: sets SUCCESS and FAILED | `src/order/order.service.spec.ts` |
| claimStock: Lua key patterns, argument order, all three return paths | `src/redis/inventory.redis.service.spec.ts` |
| revertClaim: atomic Lua eval, INCR before SREM | `src/redis/inventory.redis.service.spec.ts` |
| setStock: correct key, handles 0 and flash-sale scale | `src/redis/inventory.redis.service.spec.ts` |
| decrementStock / revertDBStock: correct repo calls, DB-before-Redis order | `src/inventory/inventory.service.spec.ts` |
| Consumer registration: ORDER_CREATED + PAYMENT_RESULT_FAILED, DLQ topic | `src/inventory/inventory.service.spec.ts` |
| ORDER_CREATED → decrementStock; PAYMENT_RESULT_FAILED → revertDBStock | `src/inventory/inventory.service.spec.ts` |
| Handler error → DLQ emit; DLQ reconciliation retries, swallows second failure | `src/inventory/inventory.service.spec.ts` |
| Consumer registration: one consumer on ORDER_CREATED | `src/payment/payment.service.spec.ts` |
| Charge succeeds: updateStatus SUCCESS, emits PAYMENT_RESULT_SUCCESS, no Redis revert | `src/payment/payment.service.spec.ts` |
| Charge fails: updateStatus FAILED, revertClaim, emits PAYMENT_RESULT_FAILED | `src/payment/payment.service.spec.ts` |
| Kafka handler error → PAYMENT_DLQ emit, no throw | `src/payment/payment.service.spec.ts` |
| findOne: returns product, NotFoundException includes product id | `src/product/product.service.spec.ts` |
| updateSaleSchedule: persists dates, rejects invalid ranges, equal start/end valid | `src/product/product.service.spec.ts` |
| updateStock: MySQL then Redis, skips Redis on MySQL failure, handles 0 and 2 000 000 | `src/product/product.service.spec.ts` |
| subscribe / push: emits to correct userId only; second subscribe overwrites | `src/sse/sse.service.spec.ts` |
| remove: completes observable, drops post-remove events, no-op for unknown userId | `src/sse/sse.service.spec.ts` |
| Kafka handler: routes SUCCESS / FAILED by topic and userId, no throw for disconnected user | `src/sse/sse.service.spec.ts` |

---

### 2. Integration Tests

Boots a real NestJS app connected to the **locally running Docker** Redis and MySQL. Kafka is mocked so no broker is needed.

**Prerequisites:** `docker compose up -d` must be running.

```bash
cd flash-sale-service
npm run test:integration
```

**What is covered:**

**`test/integration/order.controller.spec.ts`** — HTTP layer, full order flow with real MySQL and Redis

| Scenario | Expected |
|---|---|
| POST /orders — stock available, sale active | 201 |
| POST /orders — stock is 0 | 409 Out of stock |
| POST /orders — same user sends two requests | 409 Already purchased |
| POST /orders — missing userId or productId | 400 |
| POST /orders — sale not started yet | 400 |
| POST /orders — sale has ended | 400 |
| POST /orders — no sale dates (always open) | 201 |
| MySQL write fails — Redis stock and buyers set are restored | 500, no drift |
| 50 concurrent requests, 5 stock → exactly 5 succeed | 5 × 201, 45 × 409 |
| 20 concurrent requests same user → exactly 1 succeeds | 1 × 201, 19 × 409 |
| GET /orders — PENDING order → null | 200 null |
| GET /orders — FAILED order → null (user can retry) | 200 null |
| GET /orders — SUCCESS order → returns order | 200 order |

**`test/integration/inventory.service.spec.ts`** — Inventory consumer with real MySQL and Redis

| Scenario | Expected |
|---|---|
| decrementStock: MySQL stock decremented by 1 | DB stock − 1 |
| decrementStock called N times: MySQL stock decremented by N | DB stock − N |
| revertDBStock: increments MySQL, increments Redis, removes userId from buyers set | Full state restored |
| revertDBStock after a claim: both MySQL and Redis net change is zero | No drift |
| ORDER_CREATED → MySQL decremented; Redis untouched (Redis gated at order time) | DB stock − 1, Redis unchanged |
| PAYMENT_RESULT_FAILED → MySQL and Redis fully restored, userId removed from buyers | No drift |
| DLQ handler retries decrementStock on a DLQ message | DB stock − 1 |
| DLQ reconciliation failure → no throw, no second DLQ emit | Continues |

**`test/integration/payment.service.spec.ts`** — Payment processor with real Redis

| Scenario | Expected |
|---|---|
| Charge succeeds: Redis stock and buyers set untouched | No Redis change |
| Charge succeeds: emits PAYMENT_RESULT_SUCCESS, updates order to SUCCESS | Kafka event + status |
| Charge fails: Redis stock incremented (revertClaim) | Redis stock + 1 |
| Charge fails: userId removed from Redis buyers set | Buyers set clean |
| Charge fails: emits PAYMENT_RESULT_FAILED, updates order to FAILED | Kafka event + status |
| Kafka handler — payment fails: Redis reverted end-to-end | Redis restored |
| Kafka handler — payment succeeds: Redis left intact end-to-end | Redis unchanged |
| Kafka handler — processPayment throws: emits to PAYMENT_DLQ, no throw | DLQ event emitted |

**`test/integration/sse.service.spec.ts`** — SSE event delivery wired to Kafka messages

| Scenario | Expected |
|---|---|
| PAYMENT_RESULT_SUCCESS → subscriber receives data.status='SUCCESS' | Event delivered |
| PAYMENT_RESULT_FAILED → subscriber receives data.status='FAILED' | Event delivered |
| Event for a different userId is not delivered to the current subscriber | Isolation holds |
| Event for a disconnected userId → no throw | Silently dropped |
| remove() completes the observable; events pushed before remove are received | Stream closes cleanly |
| Events pushed after remove() are silently dropped | No delivery |

---

### 3. Stress Test — does the system hold under real load?

**Why k6, not Jest `Promise.all`**

| | k6 | Jest `Promise.all` |
|---|---|---|
| Concurrency model | Independent goroutines, each with a real TCP connection | Single Node.js event loop — I/O is multiplexed, not truly parallel |
| What it proves | Throughput, p95/p99 latency, error rate under sustained VU ramp | Logical correctness — exactly N claims succeed for N stock |
| Metrics | Built-in histograms, thresholds, custom counters | Pass / fail assertions only |
| Best for | "Can the system handle 500 users without falling over?" | "Does the atomic Redis lock prevent overselling?" |

**Conclusion:** use **both**. The Jest concurrency test (integration suite) proves no overselling. k6 proves the system sustains load without hitting latency SLAs or 5xx errors.

**Prerequisites:**

1. [Install k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)
2. Docker infra running (`docker compose up -d`)
3. Backend running (`npm run start:dev` in `flash-sale-service/`)

Stock seeding and sale schedule are handled automatically by the k6 `setup()` function — no manual Redis or curl commands needed.

**Run:**

```bash
cd flash-sale-service
mkdir -p test/stress/results   # create output directory on first run
k6 run test/stress/order.k6.js
```

To target a non-default host or port, pass `BASE_URL` as an environment variable:

```bash
k6 run -e BASE_URL=http://staging.example.com:3001 test/stress/order.k6.js
```

Results are written to `test/stress/results/summary.json` after the run.

**Load profile:**

| Stage | Duration | VUs | Purpose |
|---|---|---|---|
| Warm-up | 30 s | 0 → 100 | Ramp up gradually |
| Sustained | 60 s | 100 | Baseline throughput |
| Burst | 60 s | 500 | Flash-sale spike |
| Cool-down | 30 s | 500 → 0 | Drain in-flight requests |

**Thresholds (test fails if breached):**

- `p(95) < 500 ms` — 95th-percentile response time
- `order_error_rate < 1%` — unexpected 5xx / network errors

**Monitor Kafka consumer lag (Terminal 2 — run while k6 is active):**

```bash
watch -n 3 'docker exec flashsale_kafka1 \
  kafka-consumer-groups \
  --bootstrap-server localhost:9092 --describe \
  --group flash-sale-inventory-consumer \
  --group flash-sale-payment-consumer \
  --group flash-sale-sse-consumer 2>/dev/null | grep -v "^$"'
```

The `LAG` column shows how far each consumer group is behind. Lag should build during the 500-VU burst then drain back to `0` during cool-down. A lag that never recovers indicates a consumer is the bottleneck.

**Expected outcomes:**

| Metric | Expected | What it proves |
|---|---|---|
| `order_successes` | > 0 | Orders are being accepted end-to-end |
| `order_out_of_stock` | > 0 once stock exhausts | Redis atomic Lua guard is firing |
| `order_duplicates` | 0 | Each VU uses a unique `userId` — no duplicate contention in this scenario (see note below) |
| `order_unexpected_errors` | 0 | No 5xx errors under burst load |
| `p95 latency` | < 500 ms | System stays responsive at peak |
| Kafka `LAG` (Terminal 2) | Builds during burst spike, drains to `0` by cool-down | Inventory and Payment consumers keep up |

> **Duplicate guard coverage:** `order_duplicates` is `0` here by design — every VU uses a unique `userId` so the Redis `SADD` guard is populated but never contended. The guard's correctness is validated in the integration suite: the *"20 concurrent requests, same user → exactly 1 succeeds"* scenario hammers the Redis Set fast-path and the MySQL `UNIQUE(user_id, product_id)` safety net directly.

> **End-to-end pipeline latency** (order → Kafka → Payment → SSE delivery) is not measurable from this script alone — it requires an open SSE connection per VU to capture when the result arrives. This is covered by `sse.k6.js` (coming soon).

---

## Troubleshooting

**Kafka topics not created / `kafka-init` failed**

Kafka brokers can take 30–60 seconds to be ready. If `kafka-init` exited before they were healthy, re-run it:

```bash
docker compose up kafka-init
```

**Backend fails to connect to Kafka on startup**

The NestJS service connects to Kafka at boot. If Kafka wasn't fully ready when you ran `npm run start:dev`, restart the backend after the brokers are healthy:

```bash
# Confirm all kafka containers are healthy first
docker compose ps

# Then restart the backend
cd flash-sale-service && npm run start:dev
```

**Orders return "out of stock" immediately**

Redis stock counter is likely 0 or missing. Re-seed it:

```bash
docker exec flashsale_redis redis-cli SET stock:product_001 2000000
```

**Sale not active / orders rejected outside sale window**

Check and update the sale schedule via the API or directly in MySQL:

```bash
docker exec flashsale_mysql mysql -u appuser -papppassword flashsale \
  -e "SELECT id, stock, sale_start_date, sale_end_date FROM products WHERE id='product_001';"
```

**Port already in use**

Ensure nothing else is running on `3001`, `5173`, `8080`, `6379`, `3306`, or `9092–9096`.
