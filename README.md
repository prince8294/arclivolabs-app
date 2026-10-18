# Arclivo Labs — AI Business Manager

> **The Single-Owner Agency Management Operating System**  
> Complete mobile-first command center for website, software, and AI automation agencies managed entirely by a solo founder.

---

## 🚀 Overview

Arclivo Labs AI Business Manager enables a single founder and operator to run their entire agency directly from an Android mobile device:

* **Phase 1 — Outreach & Leads CRM**: Multi-format CSV lead importing, consent & permission tracking, Gemini/OpenAI draft generation, Gmail OAuth integration, and resilient scheduled background sending with daily rate limits.
* **Phase 2 — Clients, Projects & Tasks**: Comprehensive client CRM, project delivery tracker, milestone progress computation (manual & automatic), personal task checklist, and detailed audit activity logs.
* **Phase 3 — Proposals, Billing & Financial Tracking**: GST/PAN-compliant proposals, PDF quotations, sequential invoice issuance (`ARCL-INV-XXXX`), payment verification (UPI, Bank Transfer, Cheque) with balance recalculations and reversal guards, project expense tracking, and true cash surplus accounting.
* **Phase 4 — AI CEO Assistant & Intelligence**: Deterministic AI CEO Assistant (answering 15 critical business questions grounded strictly in database facts with zero hallucinations), AI Smart Daily Planner (5-level priority work schedule), Smart Business Reminders (deadlines, overdue tasks, pending payments, expiring proposals, Gmail alerts), Unified Global Search, and zero-leak JSON backup exports.
* **Phase 5 — Integration & Hardening**: Owner login gate, verified mobile/backend API contracts, complete mocked business workflow regression, safe integer-paise validation, protected document rendering, Android configuration audit, and an honest release-readiness report.

---

## 📱 Architecture & Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Mobile App** | React Native + Expo 51 + TypeScript | Android mobile client built with standalone APK preview profile |
| **Backend API** | Node.js + Express + TypeScript | Strict schema validation, atomic JSON store, rate limiting, and process isolation |
| **Security** | Scrypt + AES-256-GCM | Encrypted token store, salted passwords, and redacted exports |
| **Build System** | Expo Application Services (EAS) | Preserved project ID: `a0517e0d-54ae-4eb9-a4fe-67093b593c98` |
| **Package ID** | `com.arclivolabs.emailautomation` | Standalone release package identity |

---

## 🧭 Navigation Structure (5 Bottom Tabs)

1. **⚡ Home**: Business summary, today's work, AI CEO Assistant quick buttons, single-tap actions, and live audit activity.
2. **👥 Leads**: CSV uploads, permission verification, lead qualification, and batch dispatch management.
3. **📋 Projects**: Active and planning projects, progress meters, milestone checklists, and project financials.
4. **✨ AI (Business Center)**:
   - **💬 CEO Assistant**: Natural-language business question engine grounded in live database facts.
   - **📅 Daily Planner**: 5-level deterministic daily work plan with task completion and rescheduling.
   - **💡 Insights & Recommendations**: Actionable operational recommendations and financial intelligence.
5. **☰ More**: Operations directory for Clients, My Tasks, Proposals, Invoices, Payments, Expenses, Finance Dashboard, Reminders, Global Search, Backup Export, and System Settings.

---

## 📚 Project Documentation

* [SETUP.md](./SETUP.md) — Step-by-step local development and installation instructions.
* [API.md](./API.md) — Comprehensive REST API documentation for all phases.
* [ENVIRONMENT.md](./ENVIRONMENT.md) — Environment variables and security configurations.
* [DEPLOYMENT.md](./DEPLOYMENT.md) — Production server deployment and EAS APK build guide.
* [TESTING.md](./TESTING.md) — Automated testing matrix and verification results.
* [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) — Safe JSON database backup, snapshotting, and disaster recovery.
* [PHASE5_READINESS_REPORT.md](./PHASE5_READINESS_REPORT.md) — Verified status, fixes, security findings, test results, and remaining release blockers.

---

## 🔒 Owner-Only Guarantee
* **Zero Multi-Tenant Bloat**: Absolutely no team assignments, employee logins, client portals, or freelancer hierarchies.
* **No Fabricated Data**: AI assistants synthesize only verified numbers from actual database queries.
* **Confidentiality**: API keys and OAuth tokens are never exposed to mobile clients or included in backups.
