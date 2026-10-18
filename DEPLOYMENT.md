# Production Deployment & EAS APK Build Guide

## 📱 1. Android APK Build with Expo EAS

The mobile app uses the **existing EAS Project ID** and is configured to build directly installable `.apk` binaries without requiring a Google Play Developer account.

### Project Verification
* **Expo Project ID**: `a0517e0d-54ae-4eb9-a4fe-67093b593c98`
* **Package Name**: `com.arclivolabs.emailautomation`
* **SDK Version**: Expo SDK 51 (React Native 0.74.5)
* **Build Profile**: `preview` (with `android.buildType = "apk"`)

### APK Build Command
When ready and approved:
```bash
cd arclivo-mobile-app
eas build --platform android --profile preview
```

### Installation Over Existing APK
1. Once the EAS build completes, download the generated `.apk` file onto your Android phone via the provided link or QR code.
2. Tap the downloaded file and select **Update** (Android Package Manager will seamlessly update the app over the previous version because the package name and signing key match and `versionCode` is higher).
3. All previous local settings, secure tokens, and cached records are preserved.

### 2026 Android release limitation

The `preview` profile is correctly configured for an internally installable APK. However, Expo SDK 51 targets Android API 34. As of 2026-10-18, this is below the current Google Play target-API requirement for new apps and updates. The mobile `npm audit --omit=dev` also reports 62 transitive findings in this obsolete toolchain. Do not submit the current production profile to Google Play and do not apply the audit tool's incompatible downgrade suggestions. Perform a separate, controlled Expo SDK migration, rerun the complete test suite and dependency audit, and validate signing/update behavior first. No cloud build was started during the Phase 5 audit.

---

## ⚡ 2. Over-The-Air (OTA) Updates via EAS Update

You do **not** need to rebuild or reinstall an APK for JavaScript or asset changes (bug fixes, UI tweaks, styling).

### How It Works
* The app is configured with `runtimeVersion: { policy: "appVersion" }` and the `preview` update channel.
* Whenever the app launches, `expo-updates` checks the EAS Update servers in the background. If a compatible update is available for runtime version `1.1.0`, it downloads and applies it seamlessly.

### Publishing an Instant OTA Update
```bash
cd arclivo-mobile-app
eas update --channel preview --message "Bug fixes and UI improvements"
```
When you deploy to production:
```bash
eas update --channel production --message "Production release update"
```

---

## Production Backend Deployment

### Vercel + MongoDB Atlas

Use `arclivo-backend` as the Vercel project Root Directory. The repository includes an Express Function entrypoint and a protected daily cron invocation that is valid on Vercel Hobby.

1. Create an Atlas database user with access only to the Arclivo database and allow network access from Vercel according to your Atlas/Vercel networking plan.
2. In VS Code, open a terminal in `arclivo-backend`, place the Atlas values in the local ignored `.env`, then run `npm run migrate:mongodb` (dry run). Review counts and the source backup before running `npm run migrate:mongodb -- --commit`, followed by `npm run verify:mongodb`.
3. In Vercel **Project Settings → Environment Variables**, add every required variable listed in `ENVIRONMENT.md` to Production. Use `PERSISTENCE_DRIVER=mongodb` and the exact callback `https://arclivolabs-app.vercel.app/api/auth/google/callback`.
4. In Google Cloud Console, add that callback as an authorized redirect URI.
5. Commit and push the code changes. In Vercel choose **Deployments → Redeploy** for the intended commit. Do not use the existing deployment's cache if the compiled output appears stale.
6. Verify `GET https://arclivolabs-app.vercel.app/healthz`; it must report HTTP 200, `status: online`, and `persistence: mongodb`.
7. From the Android app, set the server URL to `https://arclivolabs-app.vercel.app/api` and sign in. A bad password must return HTTP 401; a correct password must return a signed session and allow `GET /api/stats`.
8. Inspect Vercel **Settings → Cron Jobs** and Function logs. `CRON_SECRET` is automatically sent by Vercel as a bearer value. A manual unauthenticated cron request must return HTTP 401.

Vercel Hobby permits only daily cron execution, so the committed schedule runs at 03:00 UTC. On a plan supporting frequent schedules, change it to `*/5 * * * *` before redeployment. Alternatively configure an approved external scheduler to call the same protected endpoint with the bearer secret.

### VPS / Server Requirements
* Ubuntu 22.04 LTS or 24.04 LTS (or any standard Linux server)
* Node.js v20+ LTS
* Nginx (Reverse Proxy & SSL termination)
* PM2 Process Manager (`npm install -g pm2`)

### Step-by-Step Deployment

1. **Clone & Install**:
   ```bash
   git clone <repository_url>
   cd arclivo-backend
   npm install --production=false
   npm run build
   ```

2. **Configure Production Environment**:
   ```bash
   cp .env.example .env
   nano .env
   # Set NODE_ENV=production, PORT=5000, secure keys, and GMAIL credentials
   ```

3. **Start Process with PM2**:
   ```bash
   pm2 start dist/server.js --name "arclivo-backend"
   pm2 save
   pm2 startup
   ```

4. **Nginx Reverse Proxy & HTTPS (Certbot)**:
   ```nginx
   server {
       server_name api.arclivolabs.com;

       location / {
           proxy_pass http://127.0.0.1:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
   Obtain free SSL certificate:
   ```bash
   sudo certbot --nginx -d api.arclivolabs.com
   ```

5. Verify `GET https://api.arclivolabs.com/healthz`, owner login, Gmail OAuth callback, scheduler restart recovery, and backup creation before pointing the Android app at the server.
