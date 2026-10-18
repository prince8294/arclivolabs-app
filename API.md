# Arclivo Labs REST API Reference

All requests must be made over HTTPS in production and include owner authorization where required.

```http
Authorization: Bearer <owner_session_token>
Content-Type: application/json
```

---

## 1. Authentication & System Health

### `GET /healthz`
Health check endpoint reporting API uptime and service status.

### `POST /api/auth/session`
Authenticate founder and establish an active encrypted session.
* **Body**: `{ "password": "<plain_owner_password>" }`
* **Response**: `{ "success": true, "token": "<session_token>", "expiresAt": "<iso_timestamp>" }`

---

## 2. Phase 4: AI CEO Assistant & Intelligence

### `POST /api/ai/ceo/chat`
Ask the AI CEO Assistant business questions. Combines live deterministic database synthesis with Gemini 1.5 Flash grounded prompt defense.
* **Body**: `{ "message": "What should I work on today?" }`
* **Response**:
  ```json
  {
    "reply": "Here is your priority focus for today...",
    "sources": ["tasks", "projects", "invoices"],
    "calculatedStats": { "overdueCount": 1, "todayCount": 2 },
    "suggestedActions": [
      { "label": "Open Daily Planner", "action": "navigate", "targetRoute": "planner" }
    ],
    "isDeterministic": true
  }
  ```

### `GET /api/ai/ceo/quick-questions`
Dynamically returns top context-aware questions based on current pending deadlines, overdue items, or receivables.

### `GET /api/ai/ceo/history` & `DELETE /api/ai/ceo/history`
Retrieve or clear the CEO Assistant's conversational history.

---

## 3. Phase 4: AI Smart Daily Planner

### `GET /api/planner/today?date=YYYY-MM-DD`
Computes a 5-level deterministic work schedule:
* **Level 1**: Critical & Overdue Deadlines
* **Level 2**: Today's Scheduled Commitments
* **Level 3**: Revenue & Receivables Follow-Up
* **Level 4**: Project Milestones & Development
* **Level 5**: Growth & Lead Outreach

### `POST /api/planner/complete-task`
Mark a planner task completed: `{ "taskId": "task_xyz" }`.

### `POST /api/planner/reschedule-task`
Reschedule task due date: `{ "taskId": "task_xyz", "newDueDate": "YYYY-MM-DD" }`.

---

## 4. Phase 4: Smart Business Reminders

### `GET /api/reminders`
Retrieve active smart reminders filtered for dismissed and snoozed alerts.

### `POST /api/reminders/:id/dismiss`
Dismiss a reminder so it no longer appears in the active reminder list.

### `POST /api/reminders/:id/snooze`
Temporarily hide a reminder until an ISO timestamp: `{ "snoozeUntil": "2026-10-18T10:00:00Z" }`.

---

## 5. Phase 4: Business Insights & Recommendations

### `GET /api/insights?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD`
Returns mathematically exact business metrics:
* Financials: Invoiced, Paid, Outstanding, Overdue, Expenses, Net Cash Surplus, Collection Rate %.
* Leads: Qualified count, conversion rate %.
* Projects: Active count, average progress %.
* Tasks: Total, completed, overdue, completion rate %.
* Upcoming Deadlines: Chronological list of project, invoice, and task due dates.

### `GET /api/recommendations`
Actionable business recommendations strictly derived from live bottlenecks and open opportunities.

---

## 6. Phase 4: Global Search & Backup Export

### `GET /api/search?q=<query>&category=<category>`
Universal search across Clients, Projects, Tasks, Invoices, Proposals, Leads, and Payments.

### `GET /api/backup/export`
Generates a structured, schema-versioned JSON snapshot of all business records. Redacts secrets and OAuth refresh tokens.

### `GET /api/activity-logs?limit=20`
Fetches chronological audit logs for client creation, project milestone updates, invoice creation, and payment recordings.

---

## 7. Phase 1-3 Summary Endpoints

* **Leads**: `GET /api/leads`, `POST /api/leads/upload`, `POST /api/leads/:id/generate-draft`, `PUT /api/leads/:id/draft`, `POST /api/leads/:id/approve`
* **Automation**: `POST /api/automation/toggle`, `POST /api/emails/send/:id`
* **Clients**: `GET /api/clients`, `POST /api/clients`, `PUT /api/clients/:id`
* **Projects**: `GET /api/projects`, `POST /api/projects`, `PUT /api/projects/:id`
* **Tasks**: `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/:id`
* **Proposals**: `GET /api/proposals`, `POST /api/proposals`, `PUT /api/proposals/:id`, `GET /api/proposals/:id/html`
* **Invoices**: `GET /api/invoices`, `POST /api/invoices`, `PUT /api/invoices/:id`, `POST /api/invoices/:id/void`
* **Payments**: `GET /api/payments`, `POST /api/payments`, `POST /api/payments/:id/confirm`, `POST /api/payments/:id/reverse`
* **Expenses**: `GET /api/expenses`, `POST /api/expenses`, `PUT /api/expenses/:id`, `DELETE /api/expenses/:id`
* **Finance**: `GET /api/finance/dashboard`, `GET /api/finance/project/:id`

Phase 3 mutation endpoints return `{ "success": true, "<entity>": { ... } }`. Detail endpoints return the entity plus its related records, for example invoice detail returns `{ "invoice", "client", "project", "payments" }`. Payment creation requires `invoiceId` and `amountPaise`; the backend derives `clientId` from the invoice to prevent mismatched allocations.
