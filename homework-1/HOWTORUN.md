# ▶️ How to Run the Application

## 📋 Prerequisites

- **Node.js ≥ 18** (uses built-in `fetch` and `crypto.randomUUID`). Tested on Node 20.
- **npm** (bundled with Node.js).

Check your version:

```bash
node --version
```

---

## 🚀 Run

From the `homework-1/` directory:

```bash
# 1. Install dependencies
npm install

# 2. Start the API (default port 3000, override with PORT env var)
npm start
```

You should see:

```
🏦 Banking Transactions API listening on http://localhost:3000
```

> 💡 One-command alternative: `./demo/run.sh` (installs deps if needed, then starts).
> 🔁 Live-reload during development: `npm run dev`.

---

## 🌱 Load Sample Data (optional)

With the server running, in a second terminal:

```bash
npm run seed
```

This POSTs the transactions from [`demo/sample-data.json`](demo/sample-data.json)
(a deposit, a transfer, a withdrawal and a EUR deposit) into the running API.

---

## 🧪 Testing the API

### Option A — curl

```bash
# Health check
curl http://localhost:3000/

# Create a transaction (201)
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{"fromAccount":"ACC-12345","toAccount":"ACC-67890","amount":100.50,"currency":"USD","type":"transfer"}'

# List all transactions
curl http://localhost:3000/transactions

# Filter: by account / by type / by date range (combinable)
curl "http://localhost:3000/transactions?accountId=ACC-12345"
curl "http://localhost:3000/transactions?type=transfer"
curl "http://localhost:3000/transactions?from=2024-01-01&to=2030-12-31"

# Get one transaction (use an id returned above)
curl http://localhost:3000/transactions/<id>

# Account balance
curl http://localhost:3000/accounts/ACC-12345/balance

# Account summary (Task 4A)
curl http://localhost:3000/accounts/ACC-12345/summary

# CSV export (Task 4C)
curl "http://localhost:3000/transactions/export?format=csv"
```

### Option B — VS Code REST Client

Open [`demo/sample-requests.http`](demo/sample-requests.http) and click **Send Request**
above any block (requires the "REST Client" extension).

### Option C — Postman / browser

- GET endpoints open directly in a browser (e.g. <http://localhost:3000/transactions>).
- For POST, import the requests into Postman or use the curl commands above.

---

## ✅ Expected Results (with sample data loaded)

| Request | Expected |
|---------|----------|
| `GET /accounts/ACC-12345/balance` | `{"accountId":"ACC-12345","balance":824.25}` |
| `GET /accounts/ACC-12345/summary` | `totalDeposits: 1000`, `totalWithdrawals: 175.75`, `currentBalance: 824.25`, `transactionCount: 3` |
| `POST` with `amount: -5`, `currency: "XYZ"` | `400` with a `details` array of field errors |
| `GET /transactions/does-not-exist` | `404 {"error":"Transaction not found"}` |

---

## 🔧 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on |

```bash
PORT=8080 npm start
```

---

## ⚠️ Notes

- Storage is **in-memory** — all data is cleared when the server restarts (by design; no database required).
