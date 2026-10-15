# Vaccine Cold-Chain Monitoring & Compliance Platform - Backend

REST + real-time backend that monitors vaccine shipments, temperature, location, inventory and alerts,
and computes an application-level compliance score.

> **No physical hardware is needed.** IoT temperature sensors, GPS trackers and vehicles are replaced by a
> built-in **software Simulation Engine** that generates realistic virtual temperature, GPS, vehicle,
> shipment, inventory and failure data.
>
> The compliance score is an **application-level metric** (normal readings / total readings x 100).
> It is **not** an official regulatory certification.

**Stack:** Node.js (>= 18.11) - Express - MongoDB/Mongoose - Socket.IO - JWT + bcrypt - dotenv - cors - PDFKit (plain JavaScript).

---

## 1. Architecture

```
 Simulation Engine  ->  Business logic (services)  ->  MongoDB  ->  Socket.IO  ->  React frontend
 (virtual sensors,      (alerts, inventory,            (readings,    (rooms per     (never talks to the
  GPS, vehicles)         compliance, shipments)         alerts, ...)  shipment)      engine directly)
```

The frontend only uses the REST API (including the simulation-control endpoints) and Socket.IO subscriptions.
The engine writes through the same services the REST API uses, so there is a single source of truth.

```
vaccine-cold-chain-backend/
|-- package.json  .env.example  .gitignore  README.md
|-- scripts/
|   |-- seed.js            demo data (users, vaccines, batches, stock, shipments)
|   |-- setup-env.js       creates .env with a random JWT secret
|   `-- verify.js          load-time + cross-reference sanity check (no DB needed)
|-- tests/                 node:test suites (engine, manager, validation, http, ...)
`-- src/
    |-- app.js  server.js
    |-- config/            env, db, cors, constants
    |-- models/            User Vaccine Batch Shipment TemperatureReading LocationReading Alert Inventory
    |-- controllers/       thin HTTP handlers
    |-- routes/            route tables + RBAC
    |-- middleware/        auth, validate, schemas, errorHandler, rateLimit, sanitizeQuery
    |-- services/          business logic (auth, vaccines, batches, shipments, readings, alerts,
    |                      inventory, compliance, reports, dashboard)
    |-- simulation/        simulationManager, shipmentSimulator, temperatureSimulator, gpsSimulator,
    |                      vehicleSimulator, inventorySimulator, scenarioManager
    |-- sockets/           Socket.IO server + emitter facade
    `-- utils/             geo, random, pagination, compliance maths, errors, ...
```

## 2. Installation

Requirements: **Node.js >= 18.11** and **MongoDB** (local or Atlas).

```bash
cd vaccine-cold-chain-backend
npm install
npm run setup        # creates .env from .env.example with a freshly generated JWT_SECRET
npm run seed         # demo data
npm start            # http://localhost:5000
```

Useful commands:

| Command | What it does |
|---|---|
| `npm start` | start the API + simulation engine |
| `npm run dev` | start with auto-restart (`node --watch`) |
| `npm run seed` | add demo data that is missing (safe to repeat, never overwrites) |
| `npm run seed:reset` | **wipe all collections**, then seed (needs `--force` in production) |
| `npm run verify` | load every module and check all cross-module references (no database needed) |
| `npm test` | run the test suites (`node --test`, no extra dependencies) |

### MongoDB setup

* **Local:** install MongoDB Community and start it (`mongod`, or `brew services start mongodb-community`, or `sudo systemctl start mongod`). The default URI `mongodb://127.0.0.1:27017/vaccine_cold_chain` works out of the box.
* **Docker (optional, just to run Mongo):** `docker run -d --name mongo -p 27017:27017 mongo:7`
* **Atlas:** create a free cluster, allow your IP, and put the `mongodb+srv://...` string into `MONGODB_URI`.

Indexes (including the partial unique index that prevents duplicate active alerts) are created automatically on start-up.

### `.env` setup

`npm run setup` copies `.env.example` to `.env` and generates a strong `JWT_SECRET`. Or do it manually:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste into JWT_SECRET
```

The server refuses to start when `JWT_SECRET` is missing/weak. No secret is hard-coded.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 5000 | HTTP port |
| `MONGODB_URI` | local db | MongoDB connection string |
| `JWT_SECRET` | - (required) | >= 32 chars |
| `JWT_EXPIRES_IN` | 1d | token lifetime |
| `BCRYPT_SALT_ROUNDS` | 10 | bcrypt cost |
| `CORS_ORIGINS` | localhost:3000, :5173 | comma separated allowed origins (`*` = any) |
| `SIM_TICK_INTERVAL_MS` | 3000 | real time between simulation ticks |
| `SIM_TIME_SCALE` | 60 | simulated seconds per real second (60 => 1 real s = 1 simulated min) |
| `SIM_CRUISE_SPEED_KMPH` | 50 | speed of the virtual vehicle |
| `SIM_ETA_BUFFER_FACTOR` | 1.25 | auto expected delivery = planned travel time x factor |
| `SIM_SENSOR_TIMEOUT_MS` | 10000 | silence longer than this => `SENSOR_FAILURE` alert |
| `SIM_ROUTE_TOLERANCE_KM` | 2 | distance from planned route that triggers `ROUTE_DEVIATION` |
| `EXPIRY_WARNING_DAYS` | 30 | `EXPIRY_RISK` threshold |
| `INVENTORY_SCAN_INTERVAL_MINUTES` | 15 | periodic LOW_STOCK / EXPIRY_RISK scan |
| `SEED_*_PASSWORD` | demo values | passwords used by `npm run seed` |

## 3. Demo credentials (created by `npm run seed`)

| Role | E-mail | Password |
|---|---|---|
| ADMIN | `admin@coldchain.local` | `Admin@12345` |
| OPERATOR | `operator@coldchain.local` | `Operator@12345` |
| WAREHOUSE | `warehouse@coldchain.local` | `Warehouse@12345` |

(Override with `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_PASSWORD`, `SEED_WAREHOUSE_PASSWORD`. Seeding the default passwords is refused when `NODE_ENV=production`.)

Seed data: 7 vaccines (2-8 C, frozen and ultra-cold ranges), 7 batches with stock in 4 warehouses
(`WH-CHENNAI`, `WH-BENGALURU`, `WH-COIMBATORE`, `WH-MADURAI`), and three ready-to-run shipments
`SHP-DEMO-001..003`. One batch is close to expiry and one is at its minimum stock, so the seed also produces
`EXPIRY_RISK` and `LOW_STOCK` alerts.

## 4. Quick start example

```bash
BASE=http://localhost:5000/api

# 1. log in
TOKEN=$(curl -s $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"operator@coldchain.local","password":"Operator@12345"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.token")

# 2. start the simulation of a demo shipment (it departs and begins moving)
curl -s -X POST $BASE/shipments/SHP-DEMO-001/start -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# 3. inject a failure while it is running
curl -s -X POST $BASE/simulation/SHP-DEMO-001/scenario -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"TEMPERATURE_EXCURSION","options":{"direction":"HIGH","overshootC":3}}'

# 4. watch it
curl -s $BASE/shipments/SHP-DEMO-001/temperature?limit=20 -H "Authorization: Bearer $TOKEN"
curl -s $BASE/alerts/active -H "Authorization: Bearer $TOKEN"
curl -s $BASE/shipments/SHP-DEMO-001/compliance -H "Authorization: Bearer $TOKEN"

# 5. download the PDF report
curl -s -o report.pdf $BASE/reports/shipments/SHP-DEMO-001 -H "Authorization: Bearer $TOKEN"
```

Anywhere a shipment `:id` is expected you can use either the MongoDB id or the shipment code (e.g. `SHP-DEMO-001`).

Create a shipment:

```bash
curl -s -X POST $BASE/shipments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "batchId": "<batch id>",
  "quantity": 500,
  "source":      { "name": "Chennai Central Vaccine Store", "latitude": 13.0827, "longitude": 80.2707, "warehouseId": "WH-CHENNAI" },
  "destination": { "name": "Madurai District Cold Store",  "latitude": 9.9252,  "longitude": 78.1198, "warehouseId": "WH-MADURAI" }
}'
```

`shipmentId` (auto-generated as `SHP-YYYYMMDD-XXXX` when omitted), `route` (a curved route is generated when omitted),
`expectedDelivery`, `temperatureMin/Max` (default: the vaccine's storage range) and `routeToleranceKm` are optional.

## 5. API reference

All routes are under `/api` and (except register/login) require `Authorization: Bearer <token>`.
Responses: `{ "success": true, "data": ..., "meta": { page, limit, total, totalPages } }`.
Errors: `{ "success": false, "message": "...", "details": [{ "field", "message" }] }` with proper HTTP codes
(400 validation, 401 auth, 403 role, 404, 409 conflict, 429 rate limit, 500).
List endpoints accept `page`, `limit` (max 100) and `sort` (e.g. `-createdAt`).

Health check (no auth): `GET /health`.

### Authentication
| Method & path | Roles | Notes |
|---|---|---|
| `POST /auth/register` | public | First account becomes ADMIN. Later sign-ups are OPERATOR; only an authenticated ADMIN can create ADMIN/WAREHOUSE users |
| `POST /auth/login` | public | returns `{ user, token }` (rate limited) |
| `GET /auth/me` | any | current user (password is never returned) |

### Vaccines - `/vaccines`
`GET /` (`search`, `type`, `manufacturer`) - `GET /:id` - `POST /` (ADMIN) - `PUT /:id` (ADMIN, partial update) - `DELETE /:id` (ADMIN, blocked while batches use it)

### Batches - `/batches`
`GET /` (`vaccineId`, `warehouseId`, `status`, `expiringInDays`, `search`) - `GET /:id` - `POST /` (ADMIN, WAREHOUSE) - `PUT /:id` (ADMIN, WAREHOUSE) - `DELETE /:id` (ADMIN, blocked while shipments reference it)

Creating a batch also creates its stock record in `warehouseId` (optional `minimumStock` in the body). `vaccineId` and `warehouseId` are fixed after creation; changing `quantity` adjusts the stock of the home warehouse.

### Shipments - `/shipments`
| Endpoint | Roles | Description |
|---|---|---|
| `GET /` | any | filters: `status` (comma list), `batchId`, `source`, `destination`, `search` |
| `GET /:id` | any | details with batch, vaccine, creator, simulation snapshot and alert counts |
| `POST /` | ADMIN, OPERATOR | create (status `PREPARING`); checks batch status/expiry and available stock |
| `PUT /:id` | ADMIN, OPERATOR | update planning fields while `PREPARING`; afterwards only `{"status":"CANCELLED"}` |
| `DELETE /:id` | ADMIN | not allowed while in transit |
| `POST /:id/start` | ADMIN, OPERATOR | departs the shipment and starts its simulation. Body (all optional): `scenario`, `scenarioOptions`, `timeScale`, `tickIntervalMs` |
| `GET /:id/temperature` | any | `limits`, full-range `summary`, latest `readings` (`from`, `to`, `limit` <= 5000) |
| `GET /:id/location` | any | current position, `plannedRoute`, GPS `track` |
| `GET /:id/alerts` | any | alerts of the shipment |
| `GET /:id/compliance` | any | compliance figures (see below) |
| `GET /:id/report` | any | PDF report (same as `/reports/shipments/:id`) |

### Inventory - `/inventory`
`GET /` (`warehouseId`, `batchId`) - `GET /low-stock` (quantity <= minimumStock) - `GET /expiring?days=30` - `GET /warehouse/:warehouseId` - `PATCH /:id` (ADMIN, WAREHOUSE; body `{ "minimumStock": 200 }`)

Stock moves automatically: quantity is **deducted from the source warehouse when the shipment departs**
(rejected with 409 if insufficient), **added to the destination when it is delivered**, restored on cancellation, and
reverted on reset - each movement is applied exactly once per shipment.

### Alerts - `/alerts`
`GET /` (`type`, `severity`, `resolved`, `shipmentId`) - `GET /active` (most severe first) - `PATCH /:id/resolve` (any role; `PUT` also accepted)

### Dashboard / Reports
`GET /dashboard/summary` - shipment counts by status, active shipments with live position/temperature, alert counts, inventory totals,
fleet-wide compliance score, running simulations. `GET /reports/shipments/:id` - PDF.

### Simulation control - `/simulation`
| Endpoint | Roles | Description |
|---|---|---|
| `GET /` | any | all running simulations |
| `GET /scenarios` | any | scenario catalogue with options |
| `POST /:id/start` | ADMIN, OPERATOR | start (or restart a stopped/interrupted) simulation |
| `POST /:id/pause` / `resume` | ADMIN, OPERATOR | pause / continue |
| `POST /:id/stop` | ADMIN, OPERATOR | stop, keeping the progress |
| `POST /:id/reset` | ADMIN, OPERATOR | back to `PREPARING`: discards generated readings/alerts, reverts stock movements |
| `POST /:id/scenario` | ADMIN, OPERATOR | `{ "scenario": "...", "options": { ... } }` on a running simulation |
| `GET /:id/status` | any | live state, or the persisted snapshot if not running |

### Role matrix

| | ADMIN | OPERATOR | WAREHOUSE |
|---|:-:|:-:|:-:|
| Read everything, resolve alerts, download reports | yes | yes | yes |
| Vaccines create/update/delete | yes | - | - |
| Batches create/update | yes | - | yes |
| Batches delete | yes | - | - |
| Inventory minimum stock | yes | - | yes |
| Shipments create/update/start, simulation control | yes | yes | - |
| Shipments delete | yes | - | - |

## 6. Simulation engine

`simulationManager` owns one independent `ShipmentSimulator` per running shipment, driven by its own
self-rescheduling timer (ticks never overlap; timers are cleared on pause/stop/reset/completion/shutdown).
Every tick the engine:

1. moves the **virtual vehicle** (`vehicleSimulator`: `MOVING` / `STOPPED` / `DELAYED`, smooth speed changes, occasional short stops),
2. moves the **virtual GPS device** along the route polyline (`gpsSimulator`, small jitter, optional sideways deviation),
3. generates a **temperature sample** (`temperatureSimulator`: mean-reverting process + noise + slow drift - never random jumps; excursions ramp up, hold and recover smoothly),
4. stores temperature and location readings in MongoDB,
5. emits `temperature:update` and `location:update`,
6. runs the **alert engine** (temperature limits, route deviation, delay, sensor timeout) and inventory checks,
7. updates the shipment (`PREPARING -> IN_TRANSIT -> DELAYED / CRITICAL -> DELIVERED`) and emits `shipment:update` / `simulation:update`.

On arrival the shipment is marked `DELIVERED`, `actualDelivery` is saved, the simulation stops, the delivered quantity is
booked into the destination warehouse and `simulation:completed` is emitted.

**Time:** with the defaults (`3000 ms` ticks, scale `60`) one tick advances 3 simulated minutes, so a 300 km trip at 50 km/h
takes about 6 real minutes. Change `SIM_TIME_SCALE` / `SIM_TICK_INTERVAL_MS`, or pass `timeScale` / `tickIntervalMs` to `start`.

**Scenarios** (apply at start via `scenario`, or later via `POST /simulation/:id/scenario`; each ends by itself and returns to `NORMAL`):

| Scenario | Options | Effect |
|---|---|---|
| `NORMAL` | - | clears any active failure |
| `TEMPERATURE_EXCURSION` | `direction` (`HIGH`/`LOW`), `overshootC`, `rampTicks`, `holdTicks`, `recoverTicks` | temperature drifts beyond the limit, holds, recovers -> `CRITICAL` alert, shipment `CRITICAL` |
| `VEHICLE_DELAY` | `stopMinutes`, `slowMinutes`, `slowFactor` | vehicle stops then crawls -> shipment `DELAYED`, `SHIPMENT_DELAY` alert |
| `ROUTE_DEVIATION` | `offsetKm`, `durationTicks` | vehicle drifts off the route, then returns -> `ROUTE_DEVIATION` alert |
| `SENSOR_FAILURE` | `durationTicks` | no readings -> `SENSOR_FAILURE` alert after `SIM_SENSOR_TIMEOUT_MS` |

Simulation state is snapshotted on the shipment. After a restart, interrupted simulations are marked `STOPPED` and can be
resumed with `start` (they continue from the stored progress). Graceful shutdown (`SIGINT`/`SIGTERM`) stops all timers first.

## 7. Alerts & compliance

| Alert | Severity | Raised when |
|---|---|---|
| `TEMPERATURE_EXCURSION` | CRITICAL | reading outside the shipment's min/max |
| `SHIPMENT_DELAY` | WARNING | simulated time is past `expectedDelivery` |
| `ROUTE_DEVIATION` | WARNING | distance from the planned route > `routeToleranceKm` |
| `SENSOR_FAILURE` | CRITICAL | no temperature reading for `SIM_SENSOR_TIMEOUT_MS` |
| `LOW_STOCK` | WARNING | inventory quantity <= `minimumStock` |
| `EXPIRY_RISK` | WARNING | batch with stock expires within `EXPIRY_WARNING_DAYS` (or already expired) |

**No duplicate active alerts:** an alert is unique per condition (type + shipment, or type + warehouse + batch) while it is unresolved,
enforced by a partial unique index on `dedupeKey`. Once resolved, the same condition can raise a new alert if it persists.
Stock alerts clear themselves when the condition disappears.

**Compliance** (`GET /shipments/:id/compliance`): `score = normalReadings / totalReadings x 100`, plus `totalReadings`,
`normalReadings`, `excursionReadings`, `excursionCount` (distinct excursion events), `delayCount`,
`routeDeviationCount`, `sensorFailureCount` and a disclaimer. This is an application-level indicator, **not** a regulatory certification.

**PDF report** (PDFKit): shipment info, vaccine & batch, source/destination, status, temperature summary, excursion events,
alerts, compliance score and timestamps.

## 8. Socket.IO

Connect with your JWT: `io(BASE_URL, { auth: { token } })`, then subscribe:

```js
socket.emit('shipment:join', 'SHP-DEMO-001', (ack) => console.log(ack)); // id or code -> room "shipment:<id>"
socket.emit('dashboard:join', (ack) => {});                             // fleet-wide overview room
// also: shipment:leave, dashboard:leave
socket.on('temperature:update', (p) => {});
```

| Event | Room | Payload (main fields) |
|---|---|---|
| `temperature:update` | shipment | `shipmentId, temperature, status, limits, timestamp` |
| `location:update` | shipment | `latitude, longitude, progress, speedKmph, vehicleState, distanceFromRouteKm, timestamp` |
| `shipment:update` | shipment + dashboard | `status, currentTemperature, currentLatitude/Longitude, progress, vehicle, expectedDelivery, scenario, simTime` |
| `alert:new`, `alert:resolved` | shipment (or dashboard for stock alerts) + dashboard | the alert document |
| `inventory:update` | dashboard | `warehouseId, batchId, batchNumber, quantity, minimumStock, reason` |
| `simulation:update` | shipment | every tick: `state, status, scenario, tick, progress, simTime, vehicle` |
| `simulation:started` / `paused` / `stopped` / `completed` | shipment + dashboard | lifecycle events (`stopped` carries a `reason`) |

## 9. Security

JWT authentication, bcrypt password hashing, role-based authorization, strict input validation (unknown fields dropped, types coerced,
all problems reported), NoSQL-injection-safe query handling, request size limit, CORS allow-list, rate-limited auth endpoints,
centralized error handling (no stack traces in production), passwords never serialized, secrets only from the environment.

## 10. Testing & verification

* `npm run verify` - loads every module and validates all cross-module references (works offline, no DB).
* `npm test` - unit/integration tests using Node's built-in runner: simulators, all five scenarios, the simulation manager
  lifecycle (start/pause/resume/stop/reset/shutdown), validation, error handling, the HTTP layer (health, 404, auth guard) and PDF rendering.
  The simulation tests use in-memory fakes, so no MongoDB is required.
* Manual end-to-end check: `npm run seed` -> `npm start` -> follow the quick start above.

## 11. Notes / design decisions

* Stock is checked when a shipment is created and **deducted when it departs** (`start`); planning a shipment does not reserve stock.
* A shipment that already departed cannot be edited (the running simulation works on its planned values) - cancel or reset it instead.
* `expectedDelivery`, and the timestamps of engine-generated readings and shipment alerts, are in *simulated* time, which starts at the departure time and advances `SIM_TIME_SCALE` times faster than the wall clock (so they can be ahead of the real clock); `SENSOR_FAILURE` detection uses real (wall-clock) time.
* Rate limiting is in-memory (per process); use a shared store or reverse proxy for multi-instance deployments.
