# Backup, Data Safety & Disaster Recovery Guide

Arclivo Labs AI Business Manager uses MongoDB Atlas in production. Local development and tests retain the atomic JSON database in `arclivo-backend/data/db.json`. Runtime JSON files and private migration backups are ignored by Git.

Before the first production cutover, run the JSON-to-MongoDB migration in dry-run mode, commit only into an empty target collection, and verify counts:

```bash
cd arclivo-backend
npm run migrate:mongodb
npm run migrate:mongodb -- --commit
npm run verify:mongodb
```

The commit step preserves the source and creates an ignored local backup. It refuses to overwrite or merge an existing MongoDB state document. Atlas backups/snapshots should be configured before production use.

---

## 🔒 1. Data Safety & Export Principles

1. **Owner-Initiated Snapshots**: Generated on-demand via the mobile app (**More › Backup & Data Safety**) or API (`GET /api/backup/export`).
2. **Schema Metadata**: Every export includes `schemaVersion: 4`, `exportFormat: "arclivo_backup_v4"`, and record counts for all 8 business tables.
3. **Zero Secret Leakage**: `secrets` (AI API keys) and `oauth` (Gmail refresh tokens) are **strictly redacted** during export so that backup files can be safely archived or emailed without compromising security.

---

## 💾 2. Creating a Server-Side Backup Snapshot

### Automated Cron Backup (Recommended on Server)
To take a daily automated snapshot on your server, add a cron job:

```bash
# Open crontab editor
crontab -e

# Take a daily snapshot at 2:00 AM
0 2 * * * cp /path/to/arclivo-backend/data/db.json /path/to/backups/arclivo_db_$(date +\%Y\%m\%d).json
```

### Manual Backup Command
```bash
cd arclivo-backend
mkdir -p backups
cp data/db.json backups/db_backup_$(date +%Y%m%d_%H%M%S).json
```

---

## 🔄 3. Documented Restore Procedure

If you ever need to restore your database from a backup file:

1. **Stop the Running Backend Process**:
   ```bash
   pm2 stop arclivo-backend
   # Or kill the node process
   ```

2. **Verify the Backup JSON File**:
   Ensure the backup file is valid JSON and contains `"schemaVersion"`:
   ```bash
   node -e "const d = JSON.parse(require('fs').readFileSync('my_backup.json')); console.log('Valid! Leads:', d.summary?.leadsCount || d.leads?.length);"
   ```

3. **Restore only on a separate staging copy first**. A mobile export is an envelope whose business database is under its top-level `data` property. It cannot be copied directly over `db.json`. Extract it explicitly:
   ```bash
   node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync('my_backup.json','utf8'));if(!x.data||!x.schemaVersion)throw Error('Invalid Arclivo export');fs.writeFileSync('restored-db.json',JSON.stringify(x.data,null,2),{mode:0o600})"
   ```

4. Start a staging backend with `ARCLIVO_DATA_DIR` pointing to a temporary directory containing the extracted file renamed to `db.json`. Verify record counts and financial balances. Only after verification and a second backup should the owner stop production and replace `data/db.json` with the validated staging copy.

5. **Restart the Backend Server**:
   ```bash
   pm2 start arclivo-backend
   ```
   Upon startup, the store initializes, applies migrations if necessary, and logs:
   `{"level":"info","event":"store_initialized","details":{"schemaVersion":4}}`

6. **Verify in Mobile App**:
   Open the mobile app and verify your clients, projects, invoices, and tasks are fully populated.
