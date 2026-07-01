# 🏦 Homework 1: Banking Transactions API

> **Student Name**: Andrii Melnyk (@melnykandria-ops)
> **Date Submitted**: 2026-07-01
> **AI Tools Used**: Claude Code (Anthropic, Opus 4.8)

---

## 📋 Project Overview

A minimal REST API for banking transactions, built with **Node.js + Express** and
**in-memory storage** (no database). It was implemented end-to-end with the help
of the AI coding assistant **Claude Code**: the assistant generated the project
structure, all route/validation/store modules, the demo scripts and this
documentation, and ran the API to verify every endpoint before submission.

The API supports creating and listing transactions, fetching a single
transaction, computing account balances, validating input, filtering history,
and two bonus features (account summary + CSV export).

---

## ✅ Features Implemented

### Task 1 — Core API *(required)*

| Method | Endpoint | Description | Status codes |
|--------|----------|-------------|--------------|
| `POST` | `/transactions` | Create a new transaction | `201`, `400` |
| `GET`  | `/transactions` | List all transactions (supports filters) | `200` |
| `GET`  | `/transactions/:id` | Get a single transaction | `200`, `404` |
| `GET`  | `/accounts/:accountId/balance` | Get account balance | `200`, `400` |

- In-memory storage (a plain array in [`src/store.js`](src/store.js)).
- Positive-amount validation, appropriate HTTP status codes, JSON error handling.

### Task 2 — Transaction Validation *(required)*

Implemented in [`src/validators/transactionValidator.js`](src/validators/transactionValidator.js):

- **Amount** — required, must be a positive number with **at most 2 decimal places**.
- **Accounts** — must match `ACC-XXXXX` (alphanumeric, e.g. `ACC-12345`). Which
  accounts are required depends on the transaction type (see below).
- **Currency** — must be a valid **ISO 4217** code (USD, EUR, GBP, JPY, UAH, …).
- **Type** — one of `deposit`, `withdrawal`, `transfer`.
- Returns a structured error: `{ "error": "Validation failed", "details": [ … ] }`.

### Task 3 — Transaction History Filtering *(required)*

`GET /transactions` accepts any combination of:

- `?accountId=ACC-12345` — matches `fromAccount` **or** `toAccount`
- `?type=transfer`
- `?from=2024-01-01&to=2024-01-31` — inclusive date range (date-only `to` covers the whole day)

### Task 4 — Additional Features *(2 implemented)*

- **Option A — Account Summary** → `GET /accounts/:accountId/summary`
  Returns total deposits, total withdrawals, current balance, transaction count and most recent transaction date.
- **Option C — Transaction Export** → `GET /transactions/export?format=csv`
  Streams all transactions as CSV (also supports `?format=json`).

---

## 🧠 Business Rules

- New transactions default to `status: "completed"` (can be overridden with a valid status).
- **Balance** is computed from **completed** transactions only:
  deposits and incoming transfers **credit** an account; withdrawals and outgoing transfers **debit** it.
- In the summary, `totalDeposits` = all credits (deposits + incoming transfers) and
  `totalWithdrawals` = all debits (withdrawals + outgoing transfers).
- Account requirements by type: `transfer` needs both accounts (and they must differ);
  `deposit` needs `toAccount`; `withdrawal` needs `fromAccount`. A missing optional account may be `null`.

---

## 🏗️ Architecture Decisions

```
homework-1/
├── src/
│   ├── index.js                        # Express app, middleware, error handling, router wiring
│   ├── store.js                        # In-memory data store + balance/filter logic
│   ├── routes/transactions.js          # /transactions endpoints (+ /export)
│   ├── routes/accounts.js              # /accounts/:id/balance and /summary
│   ├── validators/transactionValidator.js
│   └── utils/helpers.js                # ISO currencies, account regex, id + money helpers
├── scripts/seed.js                     # Loads demo/sample-data.json into the running API
├── demo/                               # run.sh, sample-requests.http, sample-data.json
└── docs/screenshots/                   # Screenshots (AI interaction + API running)
```

- **Separation of concerns** — routing, validation, storage and helpers are separate modules,
  so each is small and independently testable.
- **Validation returns data, not exceptions** — the validator returns an array of
  `{field, message}` errors; the route decides the HTTP response. This keeps handlers thin.
- **`/transactions/export` is declared before `/transactions/:id`** so Express doesn't treat
  `export` as an `:id` — a routing-order gotcha worth calling out.
- **No DB by design** — the store resets on restart, which is exactly what the assignment asks for.

---

## 🤖 How AI (Claude Code) Was Used

- **Scaffolding & implementation** — Claude Code generated the full folder structure and every
  source module from a description of the four tasks.
- **Iterative testing** — the assistant started the server and exercised every endpoint with
  `curl`, comparing expected vs actual (e.g. verifying `balance = 1000 − 100.50 − 75.25 = 824.25`).
- **Bug found & fixed by AI** — during testing, a `withdrawal` with an explicit `toAccount: null`
  was wrongly rejected. Claude Code traced it to the validator treating `null` as an invalid
  account string, and fixed it to treat `null`/`""`/`undefined` uniformly as "not provided".
- **Docs & demo** — this `README.md`, `HOWTORUN.md`, `demo/` files and the seed script were AI-generated.

> 📸 Screenshots of the AI interactions (prompts + generated code) and of the running API are in [`docs/screenshots/`](docs/screenshots/).

---

## 🧪 Verified Sample Output

Captured from the running server during testing (see [HOWTORUN.md](HOWTORUN.md) to reproduce):

```text
POST /transactions (deposit 1000 USD)     → 201  balance impact +1000 to ACC-12345
POST /transactions (transfer 100.50 USD)  → 201
POST /transactions (withdrawal 75.25 USD) → 201
POST /transactions (amount -5, cur XYZ)   → 400  {"error":"Validation failed","details":[…3 errors…]}
GET  /accounts/ACC-12345/balance          → {"accountId":"ACC-12345","balance":824.25}
GET  /accounts/ACC-12345/summary          → {"totalDeposits":1000,"totalWithdrawals":175.75,"currentBalance":824.25,"transactionCount":3,…}
GET  /transactions?type=transfer          → {"count":1,"transactions":[…]}
GET  /transactions/txn_unknown            → 404  {"error":"Transaction not found",…}
```

---

## ▶️ Running & Testing

See **[HOWTORUN.md](HOWTORUN.md)** for full setup, run and testing instructions.

<div align="center">

*This project was completed as part of the GenAI & Agentic AI for Software Engineering course.*

</div>
