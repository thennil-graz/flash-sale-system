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
