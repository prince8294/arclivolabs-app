# Setup & Local Development Guide

## Prerequisites

* **Node.js**: Version 20.x or higher (Tested with Node v24.11.1)
* **npm**: Version 10.x or higher
* **Expo CLI & EAS CLI**: `npm install -g eas-cli`
* **Android Device / Emulator**: For running the mobile application

---

## 🖥️ 1. Backend Server Setup

1. Navigate to the backend directory:
   ```bash
   cd arclivo-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure or reset owner authentication from an interactive terminal:
   ```bash
   npm run setup:owner-auth
   ```
   The password and confirmation are hidden. The command creates `.env` from
   `.env.example` when needed, stores only a salted scrypt hash, generates missing
   server keys, and rotates the session signing key so a reset signs out old sessions.
   It never replaces an existing `DATA_ENCRYPTION_KEY`.

4. Compile the backend:
   ```bash
   npm run build
   ```

5. Run automated tests to verify your environment:
   ```bash
   npm test
   ```

6. Start the backend development server:
   ```bash
   npm run dev
   # Server runs at http://localhost:5000 (or http://0.0.0.0:5000)
   ```

---

## 📱 2. Mobile App Setup

1. Open a new terminal and navigate to the mobile app directory:
   ```bash
   cd arclivo-mobile-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Typecheck the application:
   ```bash
   npx tsc --noEmit
   ```

4. Start the Expo development server:
   ```bash
   npm start
   # or
   npx expo start
   ```

5. Connect your device:
   * **Android Emulator**: Press `a` in the terminal to launch on the running emulator.
   * **Physical Android Phone**: Install **Expo Go** from Google Play Store and scan the displayed QR code.
   * **Host IP Configuration**: In `SettingsScreen`, enter your computer's local Wi-Fi IP (e.g. `http://192.168.1.15:5000/api`) so the phone can reach the backend.

6. On first launch, authenticate at the **Owner workspace** screen using the password corresponding to `OWNER_PASSWORD_HASH`. The password itself is never stored on the device; only the time-limited session token is stored in Expo SecureStore.

---

## 🤖 3. AI Service Configuration

1. In the mobile app, go to **More › Settings**.
2. Under **AI Provider Configuration**, select:
   * **Gemini 1.5 Flash** (Recommended for fast response times and generous rate limits)
   * **OpenAI (GPT-4o mini)**
3. Enter your AI API key and tap **Save Settings**.
4. The key is securely encrypted using AES-256-GCM on the backend and never logged or exposed in plaintext.

## Gmail OAuth Configuration

1. Create a Google OAuth **Web application** client and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` only on the backend.
2. Set `GOOGLE_REDIRECT_URI` to the exact HTTPS callback, for example `https://api.arclivolabs.com/api/auth/google/callback`, and register that URI in Google Cloud Console.
3. In the app open **More › Settings**, authenticate the owner device, then choose **Connect Gmail**.
4. Confirm the connected account with **Test Gmail Connection**. Do not send to real contacts during validation; use an explicitly consented test address.
