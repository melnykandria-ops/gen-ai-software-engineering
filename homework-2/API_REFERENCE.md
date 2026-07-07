# API Reference

📋 Complete API documentation for the Intelligent Customer Support System. All examples match real request/response shapes.

---

## Ticket Model

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| **id** | string | UUID, server-generated | Unique ticket identifier |
| **customer_id** | string | required, non-empty | Customer identifier (e.g., "CUST-123") |
| **customer_email** | string | required, valid email | Customer email address |
| **customer_name** | string &#124; null | optional, non-empty when provided | Customer name |
| **subject** | string | required, 1–200 chars | Ticket subject line |
| **description** | string | required, 10–2000 chars | Detailed problem description |
| **category** | string | enum, see below | Ticket category; defaults to `other` |
| **priority** | string | enum, see below | Priority level; defaults to `medium` |
| **status** | string | enum, see below | Workflow status; defaults to `new` |
| **assigned_to** | string &#124; null | optional, non-empty when provided | Assigned agent ID |
| **tags** | array of strings | optional, non-empty strings | User-defined tags (e.g., `["urgent", "vip"]`) |
| **metadata** | object | optional | Source, browser, device context |
| **metadata.source** | string | enum, see below | How the ticket was created (defaults to `api`) |
| **metadata.browser** | string &#124; null | optional | Browser/client identifier (e.g., "Chrome 126") |
| **metadata.device_type** | string &#124; null | enum, see below | Device category when available |
| **created_at** | string | ISO 8601, server-generated | Ticket creation timestamp |
| **updated_at** | string | ISO 8601, server-generated | Last modification timestamp |
| **resolved_at** | string &#124; null | ISO 8601, set when status="resolved" | Timestamp when ticket was resolved |
| **classification** | object &#124; null | populated by auto-classify | AI classification result (see **Classification Response** below) |

### Enum Values

**Categories:** `account_access`, `technical_issue`, `billing_question`, `feature_request`, `bug_report`, `other`

**Priorities:** `urgent`, `high`, `medium`, `low`

**Statuses:** `new`, `in_progress`, `waiting_customer`, `resolved`, `closed`

**Metadata Sources:** `web_form`, `email`, `api`, `chat`, `phone`

**Device Types:** `desktop`, `mobile`, `tablet`

---

## Endpoints

### GET / — Health Check

**Request**
```http
GET / HTTP/1.1
Host: localhost:3000
```

**Response** — `200 OK`
```json
{
  "name": "Intelligent Customer Support System",
  "status": "ok",
  "endpoints": [
    "GET /",
    "POST /tickets",
    "GET /tickets",
    "GET /tickets/:id",
    "PUT /tickets/:id",
    "DELETE /tickets/:id",
    "POST /tickets/import",
    "POST /tickets/:id/auto-classify",
    "GET /tickets/:id/classification-log"
  ]
}
```

**cURL**
```bash
curl -X GET http://localhost:3000/
```

---

### POST /tickets — Create a Ticket

Creates a single ticket. Optionally auto-classifies if `?autoClassify=true` or `auto_classify: true` in the body.

**Request**

Query Parameters:
- `autoClassify` (optional) — `true` / `'true'` / `'1'` to enable auto-classification on create

Headers:
- `Content-Type: application/json`

Body Schema:
```json
{
  "customer_id": "string (required, non-empty)",
  "customer_email": "string (required, valid email)",
  "customer_name": "string (optional, non-empty when provided)",
  "subject": "string (required, 1–200 chars)",
  "description": "string (required, 10–2000 chars)",
  "category": "string (optional, see Enum Values)",
  "priority": "string (optional, see Enum Values)",
  "status": "string (optional, see Enum Values)",
  "assigned_to": "string | null (optional, non-empty when provided)",
  "tags": ["string (non-empty), ..."],
  "metadata": {
    "source": "string (optional, see Enum Values)",
    "browser": "string (optional)",
    "device_type": "string (optional, see Enum Values)"
  },
  "auto_classify": "boolean (optional, alternative to ?autoClassify)"
}
```

**Example Request Body**
```json
{
  "customer_id": "CUST-42",
  "customer_email": "alice@acme.com",
  "customer_name": "Alice Cooper",
  "subject": "Cannot access my account",
  "description": "I've been locked out of my account after my password reset email didn't arrive. This is urgent—I cannot log in.",
  "tags": ["urgent", "login"],
  "metadata": {
    "source": "web_form",
    "device_type": "desktop"
  }
}
```

**Response** — `201 Created`
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "customer_id": "CUST-42",
  "customer_email": "alice@acme.com",
  "customer_name": "Alice Cooper",
  "subject": "Cannot access my account",
  "description": "I've been locked out of my account after my password reset email didn't arrive. This is urgent—I cannot log in.",
  "category": "account_access",
  "priority": "urgent",
  "status": "new",
  "assigned_to": null,
  "tags": ["urgent", "login"],
  "metadata": {
    "source": "web_form",
    "browser": null,
    "device_type": "desktop"
  },
  "created_at": "2026-07-07T10:30:45.123Z",
  "updated_at": "2026-07-07T10:30:45.123Z",
  "resolved_at": null,
  "classification": {
    "category": "account_access",
    "priority": "urgent",
    "confidence": 0.95,
    "reasoning": "Matched 2 keyword(s) for \"account_access\": cannot log in, password. Priority \"urgent\" (matched: urgent).",
    "keywords_found": ["cannot log in", "password", "urgent"],
    "classified_at": "2026-07-07T10:30:45.123Z",
    "applied": {
      "category": true,
      "priority": true
    },
    "overridden": false
  }
}
```

**Error Response** — `400 Bad Request`
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "customer_email",
      "message": "customer_email must be a valid email address"
    },
    {
      "field": "description",
      "message": "description must be 10-2000 characters"
    }
  ]
}
```

**cURL**
```bash
curl -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "CUST-42",
    "customer_email": "alice@acme.com",
    "customer_name": "Alice Cooper",
    "subject": "Cannot access my account",
    "description": "I'\''ve been locked out of my account after my password reset email didn'\''t arrive. This is urgent—I cannot log in.",
    "tags": ["urgent", "login"],
    "metadata": { "source": "web_form", "device_type": "desktop" }
  }'

# With auto-classification:
curl -X POST "http://localhost:3000/tickets?autoClassify=true" \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "CUST-42", "customer_email": "alice@acme.com", "subject": "Cannot access my account", "description": "I'\''ve been locked out of my account after my password reset email didn'\''t arrive. This is urgent—I cannot log in."}'
```

---

### GET /tickets — List Tickets with Filters

Retrieves all tickets, optionally filtered by status, category, priority, customer, assignment, and more. All filter parameters are optional and combinable.

**Request**

Query Parameters:
| Parameter | Type | Description |
|-----------|------|-------------|
| **status** | string | Filter by status (e.g., `new`, `in_progress`, `resolved`) |
| **category** | string | Filter by category (e.g., `account_access`, `bug_report`) |
| **priority** | string | Filter by priority (e.g., `urgent`, `high`) |
| **customer_id** | string | Filter by customer ID (exact match) |
| **assigned_to** | string | Filter by assigned agent (exact match) |
| **source** | string | Filter by metadata.source (e.g., `web_form`, `email`) |
| **tag** | string | Filter tickets with this tag (exact match on array member) |
| **q** | string | Full-text search on subject and description (case-insensitive substring) |
| **from** | string | Filter created_at >= this ISO 8601 timestamp |
| **to** | string | Filter created_at <= this ISO 8601 timestamp |

**Example Request**
```http
GET /tickets?status=open&priority=urgent&q=password HTTP/1.1
Host: localhost:3000
```

**Response** — `200 OK`
```json
{
  "count": 3,
  "tickets": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "customer_id": "CUST-42",
      "customer_email": "alice@acme.com",
      "customer_name": "Alice Cooper",
      "subject": "Cannot access my account",
      "description": "I've been locked out of my account after my password reset email didn't arrive. This is urgent—I cannot log in.",
      "category": "account_access",
      "priority": "urgent",
      "status": "new",
      "assigned_to": null,
      "tags": ["urgent", "login"],
      "metadata": {
        "source": "web_form",
        "browser": null,
        "device_type": "desktop"
      },
      "created_at": "2026-07-07T10:30:45.123Z",
      "updated_at": "2026-07-07T10:30:45.123Z",
      "resolved_at": null,
      "classification": null
    }
  ]
}
```

**cURL**
```bash
# All tickets
curl -X GET http://localhost:3000/tickets

# Urgent open tickets
curl -X GET "http://localhost:3000/tickets?status=new&priority=urgent"

# Search for "password" in urgent tickets assigned to agent-7
curl -X GET "http://localhost:3000/tickets?priority=urgent&assigned_to=agent-7&q=password"

# Tickets created in date range
curl -X GET "http://localhost:3000/tickets?from=2026-07-01T00:00:00Z&to=2026-07-07T23:59:59Z"
```

---

### GET /tickets/:id — Get a Single Ticket

Retrieves a specific ticket by its UUID.

**Request**
```http
GET /tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479 HTTP/1.1
Host: localhost:3000
```

**Response** — `200 OK`
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "customer_id": "CUST-42",
  "customer_email": "alice@acme.com",
  "customer_name": "Alice Cooper",
  "subject": "Cannot access my account",
  "description": "I've been locked out of my account after my password reset email didn't arrive. This is urgent—I cannot log in.",
  "category": "account_access",
  "priority": "urgent",
  "status": "new",
  "assigned_to": null,
  "tags": ["urgent", "login"],
  "metadata": {
    "source": "web_form",
    "browser": null,
    "device_type": "desktop"
  },
  "created_at": "2026-07-07T10:30:45.123Z",
  "updated_at": "2026-07-07T10:30:45.123Z",
  "resolved_at": null,
  "classification": null
}
```

**Error Response** — `404 Not Found`
```json
{
  "error": "Ticket not found",
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**cURL**
```bash
curl -X GET http://localhost:3000/tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

---

### PUT /tickets/:id — Update a Ticket

Updates mutable fields. Manual changes to `category` or `priority` are audit-logged as overrides. Setting `status` to `resolved` automatically stamps `resolved_at` to the new `updated_at` time.

**Request**

Headers:
- `Content-Type: application/json`

Body Schema (all fields optional):
```json
{
  "customer_id": "string (optional)",
  "customer_email": "string (optional, valid email when provided)",
  "customer_name": "string (optional, non-empty when provided)",
  "subject": "string (optional, 1–200 chars when provided)",
  "description": "string (optional, 10–2000 chars when provided)",
  "category": "string (optional, see Enum Values)",
  "priority": "string (optional, see Enum Values)",
  "status": "string (optional, see Enum Values)",
  "assigned_to": "string | null (optional, non-empty when provided)",
  "tags": ["string (non-empty), ..."],
  "metadata": {
    "source": "string (optional)",
    "browser": "string (optional)",
    "device_type": "string (optional)"
  }
}
```

**Example Request Body**
```json
{
  "status": "in_progress",
  "assigned_to": "agent-7",
  "category": "billing_question"
}
```

**Response** — `200 OK`
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "customer_id": "CUST-42",
  "customer_email": "alice@acme.com",
  "customer_name": "Alice Cooper",
  "subject": "Cannot access my account",
  "description": "I've been locked out of my account after my password reset email didn't arrive. This is urgent—I cannot log in.",
  "category": "billing_question",
  "priority": "urgent",
  "status": "in_progress",
  "assigned_to": "agent-7",
  "tags": ["urgent", "login"],
  "metadata": {
    "source": "web_form",
    "browser": null,
    "device_type": "desktop"
  },
  "created_at": "2026-07-07T10:30:45.123Z",
  "updated_at": "2026-07-07T10:35:22.456Z",
  "resolved_at": null,
  "classification": {
    "overridden": true
  }
}
```

**Error Response** — `400 Bad Request`
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "priority",
      "message": "priority must be one of: urgent, high, medium, low"
    }
  ]
}
```

**Error Response** — `404 Not Found`
```json
{
  "error": "Ticket not found",
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**cURL**
```bash
# Mark as in progress and assign
curl -X PUT http://localhost:3000/tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479 \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "assigned_to": "agent-7"}'

# Mark as resolved (auto-stamps resolved_at)
curl -X PUT http://localhost:3000/tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479 \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}'
```

---

### DELETE /tickets/:id — Delete a Ticket

Removes a ticket permanently.

**Request**
```http
DELETE /tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479 HTTP/1.1
Host: localhost:3000
```

**Response** — `204 No Content`
(empty body)

**Error Response** — `404 Not Found`
```json
{
  "error": "Ticket not found",
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**cURL**
```bash
curl -X DELETE http://localhost:3000/tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

---

### POST /tickets/import — Bulk Import

Imports multiple tickets from a CSV, JSON, or XML file. Format is detected from the `?format=` query parameter or `Content-Type` header. Returns a summary of successful and failed imports.

**Request**

Query Parameters:
- `format` (optional) — `csv`, `json`, or `xml`. If omitted, detected from `Content-Type` header
- `autoClassify` (optional) — `true` / `'true'` / `'1'` to auto-classify every successfully imported ticket

Headers:
- `Content-Type` — `text/csv`, `application/json`, or `application/xml` (if `?format=` is not provided)

Body:
Raw file content (string). See **Import Formats** section below for structure.

**Response** — `201 Created` (if at least one succeeded) or `400 Bad Request` (if none succeeded)

```json
{
  "format": "csv",
  "total": 50,
  "successful": 48,
  "failed": 2,
  "errors": [
    {
      "record": 5,
      "subject": "Refund request",
      "errors": [
        {
          "field": "customer_email",
          "message": "customer_email must be a valid email address"
        }
      ]
    },
    {
      "record": 22,
      "subject": "Technical issue",
      "errors": [
        {
          "field": "description",
          "message": "description must be 10-2000 characters"
        }
      ]
    }
  ],
  "created_ids": [
    "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "..."
  ]
}
```

**Error Response** — `400 Bad Request` (parse error)
```json
{
  "error": "Import file could not be parsed",
  "format": "csv",
  "message": "CSV contains no data rows"
}
```

**cURL**
```bash
# CSV import
curl -X POST "http://localhost:3000/tickets/import?format=csv" \
  -H "Content-Type: text/csv" \
  --data-binary @tickets.csv

# JSON import with auto-classification
curl -X POST "http://localhost:3000/tickets/import?format=json&autoClassify=true" \
  -H "Content-Type: application/json" \
  --data-binary @tickets.json

# Detect format from Content-Type
curl -X POST "http://localhost:3000/tickets/import" \
  -H "Content-Type: application/xml" \
  --data-binary @tickets.xml
```

---

### POST /tickets/:id/auto-classify — Auto-Classify a Ticket

Runs the classifier on a ticket's subject and description, returning the suggested category and priority. By default, applies the result to the ticket; use `?apply=false` for a dry-run.

**Request**

Query Parameters:
- `apply` (optional, defaults to `true`) — `false` / `'false'` / `'0'` for dry-run (report result without changing the ticket)

**Response** — `200 OK`

```json
{
  "ticket_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "category": "billing_question",
  "priority": "high",
  "confidence": 0.75,
  "reasoning": "Matched 3 keyword(s) for \"billing_question\": payment, invoice, refund. Priority \"high\" (matched: important).",
  "keywords_found": ["payment", "invoice", "refund", "important"],
  "applied": true
}
```

**Dry-Run Response** — `200 OK` (with `?apply=false`)

```json
{
  "ticket_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "category": "billing_question",
  "priority": "high",
  "confidence": 0.75,
  "reasoning": "Matched 3 keyword(s) for \"billing_question\": payment, invoice, refund. Priority \"high\" (matched: important).",
  "keywords_found": ["payment", "invoice", "refund", "important"],
  "applied": false
}
```

**Error Response** — `404 Not Found`
```json
{
  "error": "Ticket not found",
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**cURL**
```bash
# Apply classification to the ticket
curl -X POST http://localhost:3000/tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479/auto-classify

# Dry-run only
curl -X POST "http://localhost:3000/tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479/auto-classify?apply=false"
```

---

### GET /tickets/:id/classification-log — Classification Audit Trail

Retrieves all classification decisions (auto-classification on create, reclassification, dry-runs, and manual overrides) for a ticket in chronological order.

**Request**
```http
GET /tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479/classification-log HTTP/1.1
Host: localhost:3000
```

**Response** — `200 OK`

```json
{
  "ticket_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "entries": [
    {
      "decision": "auto_classify_on_create",
      "result": {
        "category": "account_access",
        "priority": "urgent",
        "confidence": 0.95,
        "reasoning": "Matched 2 keyword(s) for \"account_access\": cannot log in, password. Priority \"urgent\" (matched: urgent).",
        "keywords_found": ["cannot log in", "password", "urgent"]
      },
      "applied": {
        "category": true,
        "priority": true
      },
      "at": "2026-07-07T10:30:45.123Z"
    },
    {
      "decision": "manual_override",
      "changes": {
        "category": {
          "from": "account_access",
          "to": "billing_question"
        }
      },
      "at": "2026-07-07T10:32:10.456Z"
    },
    {
      "decision": "auto_classify_dry_run",
      "result": {
        "category": "technical_issue",
        "priority": "high",
        "confidence": 0.65,
        "reasoning": "Matched 1 keyword(s) for \"technical_issue\": error. Priority \"high\" (matched: important).",
        "keywords_found": ["error", "important"]
      },
      "applied": {
        "category": false,
        "priority": false
      },
      "at": "2026-07-07T10:35:22.789Z"
    }
  ]
}
```

**Error Response** — `404 Not Found`
```json
{
  "error": "Ticket not found",
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**cURL**
```bash
curl -X GET http://localhost:3000/tickets/f47ac10b-58cc-4372-a567-0e02b2c3d479/classification-log
```

---

## Schemas

### Classification Response

Returned by `POST /tickets/:id/auto-classify` and stored in `ticket.classification` when created with auto-classification.

```json
{
  "category": "string (one of: account_access, technical_issue, billing_question, feature_request, bug_report, other)",
  "priority": "string (one of: urgent, high, medium, low)",
  "confidence": "number (0.0 to 1.0)",
  "reasoning": "string (human-readable explanation)",
  "keywords_found": ["string", "..."],
  "classified_at": "string (ISO 8601, optional, set when stored on ticket)",
  "applied": {
    "category": "boolean",
    "priority": "boolean"
  },
  "overridden": "boolean (true if manually overridden after classification)"
}
```

### Classification Log Entry

One entry per decision in `GET /tickets/:id/classification-log`.

**On Create or Reclassify (decision = `auto_classify_on_create`, `auto_classify`, or `auto_classify_dry_run`):**
```json
{
  "decision": "auto_classify_on_create | auto_classify | auto_classify_dry_run",
  "result": {
    "category": "string",
    "priority": "string",
    "confidence": "number",
    "reasoning": "string",
    "keywords_found": ["string", "..."]
  },
  "applied": {
    "category": "boolean",
    "priority": "boolean"
  },
  "at": "string (ISO 8601)"
}
```

**On Manual Override (decision = `manual_override`):**
```json
{
  "decision": "manual_override",
  "changes": {
    "category": {
      "from": "string",
      "to": "string"
    },
    "priority": {
      "from": "string",
      "to": "string"
    }
  },
  "at": "string (ISO 8601)"
}
```

### Import Summary

Returned by `POST /tickets/import`.

```json
{
  "format": "string (csv, json, or xml)",
  "total": "number (total records in the file)",
  "successful": "number (records that passed validation and were created)",
  "failed": "number (records that failed validation)",
  "errors": [
    {
      "record": "number (1-indexed row/element number)",
      "subject": "string (the ticket's subject field, for reference)",
      "errors": [
        {
          "field": "string (field name)",
          "message": "string (validation error message)"
        }
      ]
    },
    "..."
  ],
  "created_ids": [
    "string (UUID of created ticket)",
    "..."
  ]
}
```

---

## Import Formats

All three formats support the same fields and are validated identically. Tags are pipe-separated in CSV; arrays in JSON/XML. Metadata can be nested or spread across columns in CSV.

### CSV Format

**Header Row:**
```
customer_id,customer_email,customer_name,subject,description,category,priority,status,assigned_to,tags,source,browser,device_type
```

**Example Data Row:**
```
CUST-1,user@example.com,Jane Doe,Cannot access my account,I tried to log in but my password no longer works. I am locked out and this is critical for my work.,account_access,urgent,new,,login|urgent-review,web_form,Chrome 126,desktop
```

**Full Example:**
```csv
customer_id,customer_email,customer_name,subject,description,category,priority,status,assigned_to,tags,source,browser,device_type
CUST-1,user@example.com,Jane Doe,Cannot access my account,I tried to log in but my password no longer works. I am locked out and this is critical for my work.,account_access,urgent,new,,login|urgent-review,web_form,Chrome 126,desktop
```

### JSON Format

Accepts two shapes: top-level array or `{ "tickets": [...] }`. Metadata is an object.

**Shape 1: Top-Level Array**
```json
[
  {
    "customer_id": "CUST-1",
    "customer_email": "user@example.com",
    "customer_name": "Jane Doe",
    "subject": "Cannot access my account",
    "description": "I tried to log in but my password no longer works. I am locked out and this is critical for my work.",
    "category": "account_access",
    "priority": "urgent",
    "status": "new",
    "assigned_to": null,
    "tags": ["login", "urgent-review"],
    "metadata": {
      "source": "web_form",
      "browser": "Chrome 126",
      "device_type": "desktop"
    }
  }
]
```

**Shape 2: Object with `tickets` Array**
```json
{
  "tickets": [
    {
      "customer_id": "CUST-1",
      "customer_email": "user@example.com",
      "customer_name": "Jane Doe",
      "subject": "Cannot access my account",
      "description": "I tried to log in but my password no longer works. I am locked out and this is critical for my work.",
      "category": "account_access",
      "priority": "urgent",
      "tags": ["login", "urgent-review"],
      "metadata": {
        "source": "web_form",
        "browser": "Chrome 126",
        "device_type": "desktop"
      }
    }
  ]
}
```

### XML Format

Root element must be `<tickets>` with child `<ticket>` elements. Tags are nested in `<tags><tag>...</tag></tags>`. Metadata is nested in `<metadata>`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>CUST-1</customer_id>
    <customer_email>user@example.com</customer_email>
    <customer_name>Jane Doe</customer_name>
    <subject>Cannot access my account</subject>
    <description>I tried to log in but my password no longer works. I am locked out and this is critical for my work.</description>
    <category>account_access</category>
    <priority>urgent</priority>
    <status>new</status>
    <assigned_to></assigned_to>
    <tags>
      <tag>login</tag>
      <tag>urgent-review</tag>
    </tags>
    <metadata>
      <source>web_form</source>
      <browser>Chrome 126</browser>
      <device_type>desktop</device_type>
    </metadata>
  </ticket>
</tickets>
```

---

## Error Handling

All error responses include an `error` field and a `message` or `details` field for clarity.

**Validation Error** (400)
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "customer_email",
      "message": "customer_email must be a valid email address"
    }
  ]
}
```

**Not Found** (404)
```json
{
  "error": "Ticket not found",
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**Route Not Found** (404)
```json
{
  "error": "Not found",
  "path": "/no-such-endpoint"
}
```

**Import Parse Error** (400)
```json
{
  "error": "Import file could not be parsed",
  "format": "csv",
  "message": "Malformed CSV: incomplete line at index 42"
}
```

---

## Notes

- **Timestamps** are always ISO 8601 (e.g., `2026-07-07T10:30:45.123Z`)
- **UUIDs** are used for ticket IDs (e.g., `f47ac10b-58cc-4372-a567-0e02b2c3d479`)
- **Classification** is optional and only populated when auto-classification is enabled or the ticket is reclassified
- **Null vs. Omitted:** Fields like `customer_name` and `assigned_to` default to `null` if not provided, not omitted
- **Metadata Merge:** On PUT, metadata is merged with the existing object (not replaced entirely)
- **Classification is Audit-Logged:** Every classification decision (create, reclassify, dry-run, manual override) is recorded in the log for traceability
