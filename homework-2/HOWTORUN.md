# 🎧 How to Run the Intelligent Customer Support System

## 📋 Prerequisites

- **Node.js** >= 18 (tested on version 20)
- **npm** >= 9 (included with Node.js)
- ~150 MB free disk space for dependencies
- A terminal/command prompt with `bash` (or equivalent shell)

Check your installation:

```bash
node --version    # e.g., v20.x.x
npm --version     # e.g., 9.x.x
```

---

## 📦 Installation

Navigate to the project directory and install dependencies:

```bash
cd homework-2
npm install
```

This installs all required packages including:
- **express** (4.x) — REST API framework
- **csv-parse** (5.x) — CSV import parser
- **fast-xml-parser** (4.x) — XML import parser
- **jest** + **supertest** — testing suite

---

## 🔧 Environment Setup

The system requires minimal configuration. Supported environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP server port |

**Example:** To run on port 8080:

```bash
PORT=8080 npm start
```

No database, authentication, or other config needed — the system uses an in-memory store that resets on restart.

---

## 🚀 Run the Server

### Option 1: Production Mode

```bash
npm start
```

Starts the server on `http://localhost:3000` (or your custom `PORT`). One instance, no file watching.

**Output:**
```
🎧 Intelligent Customer Support System listening on http://localhost:3000
```

### Option 2: Development Mode (File Watch)

```bash
npm run dev
```

Uses Node's `--watch` flag. Server restarts automatically when you edit files in `src/`.

### Option 3: Demo Script

```bash
./demo/run.sh
```

Convenience script that:
1. Ensures dependencies are installed
2. Prints the server URL
3. Starts the server (same as `npm start`)

---

## 🌐 Access the Dashboard

Once the server is running, open your browser:

```
http://localhost:3000/ui
```

You will see a dark-themed dashboard with:
- **Stat tiles**: Total tickets, by category, by priority
- **Charts**: Category and priority distributions (bar charts)
- **Filter controls**: Status, category, priority, customer, assignee, source, tag, date range, search
- **Ticket table**: All tickets with quick-action buttons
- **Detail drawer**: Click a ticket row to view/edit full details, auto-classify, or delete
- **Create modal**: "New Ticket" button to add tickets one at a time
- **Bulk import modal**: "Import" button to upload CSV/JSON/XML files

---

## 🌱 Seed Sample Data

To populate the dashboard with 100 sample tickets (50 CSV + 20 JSON + 30 XML), run:

```bash
npm run seed
```

**Prerequisites:** The API must be running (another terminal window with `npm start` or `npm run dev`).

**What it does:**
1. Imports `tests/fixtures/sample_tickets.csv` (50 tickets)
2. Imports `tests/fixtures/sample_tickets.json` (20 tickets)
3. Imports `tests/fixtures/sample_tickets.xml` (30 tickets)
4. Auto-classifies all imported tickets (category & priority)
5. Prints a summary: `200 sample_tickets.csv: total=50 ok=50 failed=0`

**Output example:**
```
200 sample_tickets.csv: total=50 ok=50 failed=0
201 sample_tickets.json: total=20 ok=20 failed=0
201 sample_tickets.xml: total=30 ok=30 failed=0
Total tickets in store: 100
```

The fixtures are deterministically generated and can be regenerated with:

```bash
npm run fixtures
```

---

## ✅ Quick Verification Checklist

Verify the server is working correctly by running these curl commands in another terminal window:

### 1. Health Endpoint

```bash
curl http://localhost:3000/
```

**Expected response (200 OK):**
```json
{
  "name": "Intelligent Customer Support System",
  "status": "ok",
  "endpoints": [
    "POST /tickets",
    "POST /tickets/import?format=csv|json|xml",
    "GET /tickets",
    "GET /tickets/:id",
    "PUT /tickets/:id",
    "DELETE /tickets/:id",
    "POST /tickets/:id/auto-classify",
    "GET /tickets/:id/classification-log",
    "GET /ui (dashboard)"
  ]
}
```

### 2. Create a Single Ticket

```bash
curl -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "CUST-TEST-001",
    "customer_email": "test@example.com",
    "customer_name": "Test User",
    "subject": "Login page returns error 500",
    "description": "The login page shows error 500 for all users. This is urgent and blocking our whole team.",
    "tags": ["urgent", "outage"]
  }' \
  -w '\nStatus: %{http_code}\n'
```

**Expected response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "customer_id": "CUST-TEST-001",
  "customer_email": "test@example.com",
  "customer_name": "Test User",
  "subject": "Login page returns error 500",
  "description": "The login page shows error 500 for all users. This is urgent and blocking our whole team.",
  "category": "technical_issue",
  "priority": "urgent",
  "status": "open",
  "tags": ["urgent", "outage"],
  "created_at": "2026-07-07T12:34:56.789Z",
  "updated_at": "2026-07-07T12:34:56.789Z"
}
```

Note: `category` and `priority` are auto-assigned by the classifier.

### 3. Bulk Import CSV

```bash
curl -X POST http://localhost:3000/tickets/import?autoClassify=true \
  --data-binary @tests/fixtures/sample_tickets.csv \
  -H "Content-Type: text/csv" \
  -w '\nStatus: %{http_code}\n'
```

**Expected response (201 Created):**
```json
{
  "total": 50,
  "successful": 50,
  "failed": 0,
  "errors": []
}
```

### 4. List Tickets with Combined Filters

```bash
curl "http://localhost:3000/tickets?category=technical_issue&priority=urgent&status=open&limit=10"
```

**Expected response (200 OK):** Array of up to 10 tickets matching all filters.

---

## 🧪 Testing Guide

The project includes a comprehensive test suite with >85% code coverage across 8 test suites (158 tests).

### Run All Tests

```bash
npm test
```

**Expected output:**
```
 PASS  tests/test_ticket_model.test.js
 PASS  tests/test_ticket_api.test.js
 PASS  tests/test_import_csv.test.js
 PASS  tests/test_import_json.test.js
 PASS  tests/test_import_xml.test.js
 PASS  tests/test_categorization.test.js
 PASS  tests/test_integration.test.js
 PASS  tests/test_performance.test.js

Test Suites: 8 passed, 8 total
Tests:       158 passed, 158 total
Snapshots:   0 total
Time:        12.345 s
```

### Run Tests with Coverage Report

```bash
npm run test:coverage
```

Generates a coverage report (printed to terminal + HTML in `coverage/` directory).

**Thresholds (enforced):**
| Metric | Threshold | Actual |
|--------|-----------|--------|
| Statements | 85% | ~94% |
| Branches | 85% | ~89% |
| Functions | 85% | ~96% |
| Lines | 85% | ~96% |

The test suite validates:
- ✅ Ticket model validation (email, subject length, description length, etc.)
- ✅ All REST endpoints (CRUD operations, error cases)
- ✅ CSV/JSON/XML import parsers and error handling
- ✅ Auto-classification logic (keyword scoring, confidence, priority rules)
- ✅ Filtering and search (combinable query parameters)
- ✅ Integration workflows (import → classify → query)
- ✅ Performance benchmarks (under 5s on the test suite)

---

## 🔧 Troubleshooting

### Port Already in Use (EADDRINUSE)

**Error:** `Error: listen EADDRINUSE: address already in use :::3000`

**Solution:**

```bash
# Find the process using port 3000
lsof -ti:3000

# Kill it
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm start
```

### Node Version Too Old

**Error:** `Unexpected token '??=' (SyntaxError)` or similar

**Solution:**

```bash
node --version

# If < 18, upgrade Node.js from https://nodejs.org/
# Or use a tool like nvm (Node Version Manager):
nvm install 20
nvm use 20
```

### Dependencies Not Installed

**Error:** `Cannot find module 'express'`

**Solution:**

```bash
rm -rf node_modules package-lock.json
npm install
```

### API Not Responding

**Error:** `curl: (7) Failed to connect to localhost port 3000`

**Check:**
1. Is the server running? (`npm start` in another terminal)
2. Did it start on a different port? (Check terminal output)
3. Try a different port: `PORT=8080 npm start`
4. Check firewall settings

### Seed Script Fails

**Error:** `Seed failed: fetch error`

**Solutions:**
1. Ensure the API is running: `npm start` in another terminal
2. Verify the port matches: `PORT=3000 npm run seed`
3. Check network connectivity (if using custom HOST)

### Tests Fail / Hang

**Error:** `Tests timeout after 5000ms` or similar

**Solutions:**
```bash
# Run with longer timeout
npm test -- --testTimeout=10000

# Run a single test file
npm test tests/test_ticket_api.test.js

# Verbose output for debugging
npm test -- --verbose
```

---

## 📚 Additional Resources

- **API Reference:** See `docs/API_REFERENCE.md`
- **Architecture:** See `docs/ARCHITECTURE.md`
- **Testing Details:** See `docs/TESTING_GUIDE.md`
- **Project Tasks:** See `TASKS.md`

---

## 🎓 About This Project

**Course:** GenAI & Agentic AI for Software Engineering  
**Homework:** 2 — Intelligent Customer Support System  
**Student:** Andrii Melnyk (@melnykandria-ops)  
**Date:** 2026-07-07  
**Tech Stack:** Node.js 20 + Express 4  
**Status:** Complete (158 tests passing, 94%+ coverage)

Built with Claude Code — AI-assisted development for modern applications.
