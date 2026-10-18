# Environment & Configuration Guide

This document defines all environment variables used by the Arclivo Labs backend.  
**Never commit real secrets or `.env` files to git.**

---

## 🔐 Required Environment Variables

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `NODE_ENV` | Runtime environment | `development` or `production` |
| `PORT` | Listening port for Express HTTP server | `5000` |
| `ARCLIVO_DATA_DIR` | Directory path where atomic JSON database files are stored | `./data` |
| `DATA_ENCRYPTION_KEY` | 32-byte base64-encoded key for AES-256-GCM secret encryption | Created by `npm run setup:owner-auth` when missing; never rotate it casually |
| `SESSION_SIGNING_KEY` | 32+ character string for HMAC-SHA256 session token signatures | Created and rotated by `npm run setup:owner-auth` |
| `OWNER_PASSWORD_HASH` | Formatted salted scrypt hash of the founder's password | Created by `npm run setup:owner-auth` |

---

## ✉️ Gmail OAuth & Scheduler Settings

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `GMAIL_CLIENT_ID` | Google Cloud Console OAuth 2.0 Web Client ID | `your-id.apps.googleusercontent.com` |
| `GMAIL_CLIENT_SECRET` | Google Cloud Console OAuth 2.0 Client Secret | `your-secret-here` |
| `GMAIL_REDIRECT_URI` | Authorized OAuth redirect callback URL | `https://yourdomain.com/api/oauth/gmail/callback` |
| `SCHEDULER_POLL_MS` | Polling frequency for the automated background sending loop | `300000` (5 minutes) |
| `BUSINESS_TIMEZONE` | Business timezone used for daily reset and schedule planning | `Asia/Kolkata` |

---

## 🤖 AI Provider Settings (Configured via Mobile App or Server)

| Variable | Description |
| :--- | :--- |
| `GEMINI_API_KEY` | Optional default API key for Google Gemini 1.5 Flash |
| `OPENAI_API_KEY` | Optional default API key for OpenAI GPT models |

*Note: In normal single-owner operations, the AI API key can be set directly from the Android app in **More › Settings**, which encrypts and saves it directly to the server store.*
