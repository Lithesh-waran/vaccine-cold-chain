# Vaccine Cold-Chain Monitoring & Compliance Platform

A full-stack, enterprise-grade MERN platform designed to monitor vaccine shipments, cold-chain temperature compliance, inventory levels, and real-time alerts.

Built with **Node.js, Express, MongoDB/Mongoose, Socket.IO, React, Vite, Leaflet, and Recharts**.

> **Hardware-Free Software Simulation:** IoT temperature sensors, GPS trackers, and vehicles are simulated in software. The platform generates realistic telemetry, route tracking, temperature excursions, sensor dropouts, and vehicle delays without requiring physical hardware.
>
> **Application-Level Compliance:** The compliance score is an application-level operational metric (`normal readings / total readings × 100`).

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Client (React + Vite)                         │
│  - Operations Dashboard with Real-Time Telemetry                       │
│  - Interactive Leaflet Route Tracking & Position Map                   │
│  - Recharts Temperature Excursion History with Safe-Zone Thresholds   │
│  - Warehouse Stock & Expiry Tracking                                   │
│  - Incident Management & Resolution Workflow                           │
│  - Automated PDF Compliance Report Downloads                           │
└───────────────────▲───────────────────────────────▲────────────────────┘
                    │ REST API                      │ WebSocket (Socket.IO)
┌───────────────────▼───────────────────────────────┴────────────────────┐
│                    Backend Server (Express + Socket.IO)                │
│  - JWT Authentication & Role-Based Access Control (RBAC)               │
│  - RESTful APIs for Shipments, Vaccines, Batches, Inventory, & Alerts   │
│  - Event-Driven Alert Deduplication & Persistence                      │
│  - PDF Report Generation Engine (PDFKit)                               │
└───────────────────▲───────────────────────────────▲────────────────────┘
                    │                               │
┌───────────────────▼───────────────┐   ┌───────────▼────────────────────┐
│         MongoDB Database          │   │   Software Simulation Engine   │
│  - Strict Mongoose Schemas        │   │  - Virtual Temperature Sensor  │
│  - Partial Unique Indexes         │   │  - Virtual GPS & Polyline Nav  │
│  - Auto-Cleanup & Stale Recovery  │   │  - Scenario Injector & Timers  │
└───────────────────────────────────┘   └────────────────────────────────┘
```

---

## Key Features

1. **Role-Based Access Control (RBAC):**
   - **Admin:** Full oversight across all resources, configuration, user operations, and simulation controls.
   - **Operator:** Manages shipments, monitors live routes, runs simulations, and resolves alerts.
   - **Warehouse Staff:** Manages inventory stock levels, tracks batch expiries, and logs product availability.

2. **Real-Time Simulation Engine:**
   - **Normal Transit:** Simulates vehicles moving smoothly along real-world polyline routes (e.g. Chennai → Bengaluru) while keeping temperatures inside vaccine-specific thresholds.
   - **Temperature Excursion:** Ramps temperature beyond safe limits (e.g., cooling system failure), generating real-time critical alerts.
   - **Sensor Failure:** Simulates telemetry loss, triggering timeouts and sensor-failure alerts.
   - **Route Deviation:** Simulates vehicles leaving the planned route, raising geographic warnings.
   - **Vehicle Delay:** Simulates transit breakdown, automatically recalculating ETAs and raising shipment delay notifications.

3. **Intelligent Alert Deduplication:**
   - Database-level partial unique indexes ensure that recurring sensor ticks for an ongoing breach never flood operators with duplicate active alerts.

4. **Audit & Compliance Reporting:**
   - Generate official PDF trip summaries with route metrics, temperature excursions, alert logs, and operational compliance scores.

---

## Directory Structure

```
vaccine_cold_chain/
├── backend/
│   ├── src/
│   │   ├── config/          # Environment, database, CORS, and constants
│   │   ├── controllers/     # HTTP request handlers
│   │   ├── middleware/      # Auth, RBAC, schema validation, rate limiting, sanitization
│   │   ├── models/          # Mongoose models (User, Shipment, Alert, Vaccine, etc.)
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Business logic & PDF report generation
│   │   ├── simulation/      # Virtual sensor, GPS, and scenario simulation engine
│   │   ├── sockets/         # Real-time Socket.IO dispatchers
│   │   └── utils/           # Geo math, compliance calculations, errors, logger
│   ├── scripts/             # Seed demo data, environment bootstrap, sanity verification
│   └── tests/               # Automated unit and integration test suite (node:test)
├── client/
│   ├── src/
│   │   ├── context/         # AuthContext and session management
│   │   ├── hooks/           # useLive WebSocket hook
│   │   ├── services/        # Axios API client and Socket.IO connection
│   │   ├── App.jsx          # Full React application & view components
│   │   └── styles.css       # Design system and responsive styles
│   ├── vercel.json          # SPA rewrite rules for Vercel
│   └── vite.config.js       # Vite configuration with vendor chunk splitting
├── Dockerfile               # Multi-stage Docker build
├── docker-compose.yml       # Full-stack container orchestration
├── render.yaml              # Render deployment blueprint
└── package.json             # Root monorepo runner
```

---

## Local Development Setup

### Prerequisites
- **Node.js** >= 18.11
- **MongoDB** (Local daemon or MongoDB Atlas URI)

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Lithesh-waran/vaccine_cold_chain.git
   cd vaccine_cold_chain
   ```

2. **Install all dependencies:**
   ```bash
   npm run install:all
   ```

3. **Configure the backend environment:**
   ```bash
   cd backend
   npm run setup    # Generates a random 48-byte JWT secret and copies .env.example
   ```

4. **Seed demo data:**
   ```bash
   npm run seed
   ```

5. **Start development servers:**
   - In terminal 1 (Backend):
     ```bash
     cd backend
     npm run dev
     ```
   - In terminal 2 (Frontend):
     ```bash
     cd client
     npm run dev
     ```

6. Open your browser at `http://localhost:5173`.

### Default Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@coldchain.local` | `Admin@12345` |
| **Operator** | `operator@coldchain.local` | `Operator@12345` |
| **Warehouse** | `warehouse@coldchain.local` | `Warehouse@12345` |

---

## Running Automated Tests

Run the backend verification and test suite (42 unit and integration tests):

```bash
# Run sanity cross-module check
npm run verify

# Run all automated test suites
npm run test
```

---

## Production Deployment Guide

### Architecture Choices

1. **Decoupled Architecture (Recommended):**
   - **Frontend:** Hosted on **Vercel** or **Netlify** (CDN-backed static SPA).
   - **Backend:** Hosted on **Render**, **Railway**, or **Fly.io** (Persistent Node container required for Socket.IO).
   - **Database:** Hosted on **MongoDB Atlas**.

2. **Unified Single-Service Architecture:**
   - Deploy both backend and client as a single Docker container or Node service. Express automatically serves `client/dist` when `SERVE_STATIC=true` or in production.

---

### Step 1: Set up MongoDB Atlas
1. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Add a database user with read/write privileges.
3. In Network Access, allow access from your deployment IP addresses (or `0.0.0.0/0` with secure credentials).
4. Copy your connection string:
   ```
   mongodb+srv://<user>:<password>@cluster0.mongodb.net/vaccine_cold_chain?retryWrites=true&w=majority
   ```

---

### Step 2: Deploy Backend (Render / Railway)

#### Deploying on Render:
1. Connect your GitHub repository to [Render](https://render.com).
2. Create a new **Web Service**:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
3. Add Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `MONGODB_URI`: `<your-atlas-uri>`
   - `JWT_SECRET`: `<random-32+-character-string>`
   - `CORS_ORIGINS`: `https://<your-frontend-domain>.vercel.app`
4. Deploy and note your backend URL (e.g., `https://coldchain-api.onrender.com`).

---

### Step 3: Deploy Frontend (Vercel)

1. Connect your GitHub repository to [Vercel](https://vercel.com).
2. Configure project settings:
   - **Root Directory:** `client`
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add Environment Variables:
   - `VITE_API_URL`: `https://<your-backend-url>/api`
   - `VITE_SOCKET_URL`: `https://<your-backend-url>`
4. Deploy. The included `client/vercel.json` ensures direct page refreshes resolve cleanly without 404s.

---

### Step 4: One-Time Production Database Seed

To populate the initial admin accounts, vaccines, and sample batches on your live database, run:

```bash
cd backend
MONGODB_URI="<your-production-atlas-uri>" npm run seed
```

---

### Deploy with Docker & Docker Compose

To run the complete stack locally or on a VPS using Docker:

```bash
docker compose up --build -d
```
The application will be accessible at `http://localhost:5000`.

---

## Security Highlights

- **No Secrets in Code:** Sensitive values and keys are strictly excluded via `.gitignore` and managed through environment variables.
- **Strict Query Parsing:** Sanitizes URL queries against NoSQL injection operators (`$ne`, `$gt`).
- **Brute-Force Protection:** Rate limiting applied to authentication routes (`/api/auth/*`).
- **Security Headers:** Enforces `nosniff`, `DENY` framing, and referrer protections.
- **Safe Production Errors:** Production responses mask internal stack traces and server internals.
