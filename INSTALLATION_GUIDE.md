# Arclivo Labs - Simple Android AI Email Automation App
## Installation, Setup & APK Build Guide

### 📱 1. Fast APK Generation (1 Command via Expo EAS)
The mobile app is pre-configured with **Expo EAS Build** in `eas.json` using the `preview` profile, which outputs a standalone, directly installable **Android `.apk` file** (no Google Play Store account required).

1. Open your terminal in the `arclivo-mobile-app` folder:
   ```bash
   cd arclivo-mobile-app
   ```
2. Run the build command:
   ```bash
   npm run build:apk
   # or directly:
   eas build -p android --profile preview
   ```
3. Expo EAS will compile the Android APK in the cloud and output:
   - A direct **download URL** for the `.apk` file
   - A **QR code** in your terminal that you can scan with your Android phone camera to download the APK immediately!

---

### 📲 2. Installing the APK on your Android Phone
1. Once downloaded, open the `.apk` file on your Android phone (from your browser downloads or Files app).
2. If prompted with *"For your security, your phone is not allowed to install unknown apps from this source"*:
   - Tap **Settings** on the prompt.
   - Toggle **Allow from this source** to ON.
   - Tap back and tap **Install**.
3. Open **Arclivo AI Email** from your app drawer.

---

### 🖥️ 3. Starting the Node.js Backend Server
Configure owner authentication and encrypted server-side secret storage using `arclivo-backend/.env.example` and `arclivo-backend/README.md` before production use.

1. In the `arclivo-backend` directory:
   ```bash
   cd arclivo-backend
   ```
2. Install, build, and start on Node.js 20+:
   ```bash
   npm install
   npm run build
   npm start
   ```
3. The server starts at `http://localhost:5000` (or `http://YOUR_LOCAL_IP:5000` on your Wi-Fi network).
4. In Settings, configure the server address and authenticate with the backend owner password. Use HTTPS outside local development.

---

### ⚡ 4. App Workflow (Only 5 Screens)
1. **Home Screen**:
   - Shows 4 core live metrics: **Total CSV Leads**, **Emails Sent**, **Pending Emails**, and **Failed Emails**.
   - Tap **Start Automation** to launch the background sending loop, or **Pause Automation** at any time.
2. **Upload CSV Screen**:
   - Tap **Choose CSV from Phone Storage** to upload any CSV file (10, 100, 500+ records) from your phone.
   - Or tap **10 Leads / 100 Leads / 500 Leads** to instantly load test data.
   - Columns: `Business Name, Email, Website, Category, City, Contact Permission`.
   - Automatic email syntax validation & duplicate detection.
3. **Leads Screen**:
   - Search businesses by name, email, city, or industry.
   - Filter by **Pending**, **Sent**, or **Failed**.
   - Remove unwanted leads with a single tap.
4. **AI Emails Screen**:
   - Tap **Generate All** to automatically draft personalized emails for all eligible leads offering Arclivo Labs website development & AI automation.
   - Tap **Preview & Edit** on any lead to customize the subject or body before sending.
   - Tap **Send Now** to send immediately through connected Gmail.
5. **Settings Screen**:
   - Connect or disconnect Gmail (Google OAuth 2.0).
   - Configure AI API key securely (Gemini / OpenAI) stored on backend.
   - Set daily email sending limit (default: 5 emails/day).
   - Toggle automatic background sending ON/OFF.
   - Test Gmail connection.

---

### 🛡️ 5. Compliance & Anti-Spam Protections
- **Contact Permission Requirement**: Leads without documented permission (`Contact Permission = No`) are automatically flagged as ineligible and will never be contacted.
- **Strict Duplicate Prevention**: Emails sent in prior batches are permanently blocked from re-sending.
- **Mandatory Opt-Out**: Every AI-generated email automatically includes an unsubscribe footer (`Reply 'Unsubscribe' to opt out`).
- **Paced Scheduling**: Default 5 emails per day ensures Gmail anti-spam thresholds are respected and domain reputation remains pristine.
