'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');

const root = path.resolve(__dirname, '..');
const sourcePath = path.resolve(process.env.ARCLIVO_MIGRATION_SOURCE || path.join(root, 'data', 'db.json'));
const backupDir = path.join(root, 'private-backups');
const args = new Set(process.argv.slice(2));
const commit = args.has('--commit');
const verifyOnly = args.has('--verify');

if ([...args].some(arg => !['--commit', '--verify'].includes(arg))) {
  throw new Error('Supported options are --commit and --verify. Migration is a dry run by default.');
}
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
if (!fs.existsSync(sourcePath)) throw new Error('Migration source JSON file was not found.');

const raw = fs.readFileSync(sourcePath);
if (raw.length >= 15 * 1024 * 1024) {
  throw new Error('Source is too large for the single-document adapter. Split/normalize storage before migration.');
}
const data = JSON.parse(raw.toString('utf8'));
if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Source must contain one JSON object.');

const dbName = process.env.MONGODB_DB_NAME || 'arclivo';
const collectionName = process.env.MONGODB_STATE_COLLECTION || 'app_state';
const checksum = crypto.createHash('sha256').update(raw).digest('hex');
const countFields = ['leads', 'logs', 'emailRecords', 'suppressions', 'auditLogs', 'clients', 'projects', 'tasks', 'notes', 'activityLogs', 'proposals', 'invoices', 'payments', 'expenses', 'chatHistory'];
const counts = value => Object.fromEntries(countFields.map(field => [field, Array.isArray(value[field]) ? value[field].length : 0]));

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  });
  try {
    await client.connect();
    const collection = client.db(dbName).collection(collectionName);
    const existing = await collection.findOne({ _id: 'primary' });

    if (verifyOnly) {
      if (!existing) throw new Error('MongoDB does not contain the primary state document.');
      const sourceCounts = counts(data);
      const targetCounts = counts(existing.data || {});
      for (const field of countFields) {
        if (sourceCounts[field] !== targetCounts[field]) {
          throw new Error(`Verification failed: record count differs for ${field}.`);
        }
      }
      process.stdout.write('Migration verification passed: all tracked collection counts match.\n');
      return;
    }

    if (existing) {
      throw new Error('MongoDB already contains application state. Refusing to overwrite or merge records.');
    }

    process.stdout.write(`Source validated (${raw.length} bytes, SHA-256 ${checksum}).\n`);
    process.stdout.write(`Record counts: ${JSON.stringify(counts(data))}\n`);
    if (!commit) {
      process.stdout.write('Dry run complete. No database writes were performed. Re-run with --commit after reviewing the backup and counts.\n');
      return;
    }

    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `db.pre-mongodb-${timestamp}.json`);
    fs.writeFileSync(backupPath, raw, { flag: 'wx', mode: 0o600 });

    await collection.insertOne({
      _id: 'primary',
      revision: 0,
      schemaVersion: Number.isSafeInteger(data.schemaVersion) ? data.schemaVersion : 1,
      updatedAt: new Date(),
      migration: { sourceChecksumSha256: checksum, importedAt: new Date() },
      data,
    });
    process.stdout.write('Migration committed without modifying the source file. Run --verify before redeployment.\n');
    process.stdout.write(`Private local backup created: ${path.relative(root, backupPath)}\n`);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
