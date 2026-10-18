'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');

const envFile = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!envFile || !fs.existsSync(envFile)) {
  throw new Error('Pass the path to an environment file exported securely from the deployment platform.');
}

const values = dotenv.parse(fs.readFileSync(envFile));
const required = [
  'NODE_ENV',
  'PERSISTENCE_DRIVER',
  'MONGODB_URI',
  'MONGODB_DB_NAME',
  'MONGODB_STATE_COLLECTION',
  'OWNER_PASSWORD_HASH',
  'SESSION_SIGNING_KEY',
  'SESSION_TTL_SECONDS',
  'DATA_ENCRYPTION_KEY',
  'CRON_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'REQUEST_BODY_LIMIT',
  'GMAIL_TIMEOUT_MS',
];

const result = (name, valid, detail = '') => {
  process.stdout.write(`${name}: ${valid ? 'valid' : 'INVALID'}${detail ? ` (${detail})` : ''}\n`);
};

for (const name of required) {
  const value = values[name] || '';
  result(`${name} present`, Boolean(value));
  if (value.startsWith(`${name}=`)) result(`${name} value shape`, false, 'contains an accidental KEY= prefix');
  if (value.includes('\n') || value.includes('\r')) result(`${name} value shape`, false, 'contains a newline');
}

result('NODE_ENV', values.NODE_ENV === 'production');
result('PERSISTENCE_DRIVER', values.PERSISTENCE_DRIVER === 'mongodb');
result('MONGODB_URI scheme', /^mongodb(\+srv)?:\/\//.test(values.MONGODB_URI || ''));
result('MONGODB_DB_NAME', values.MONGODB_DB_NAME === 'arclivo');
result('MONGODB_STATE_COLLECTION', values.MONGODB_STATE_COLLECTION === 'app_state');
result('OWNER_PASSWORD_HASH format', /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/i.test(values.OWNER_PASSWORD_HASH || ''));
result('SESSION_SIGNING_KEY length', (values.SESSION_SIGNING_KEY || '').length >= 32);
result('SESSION_TTL_SECONDS', values.SESSION_TTL_SECONDS === '43200');
result('DATA_ENCRYPTION_KEY length', Buffer.from(values.DATA_ENCRYPTION_KEY || '', 'base64').length === 32);
result('CRON_SECRET length', (values.CRON_SECRET || '').length >= 32);
result(
  'GOOGLE_REDIRECT_URI',
  values.GOOGLE_REDIRECT_URI === 'https://arclivolabs-app.vercel.app/api/auth/google/callback'
);

async function checkMongo() {
  if (!values.MONGODB_URI) return;
  const client = new MongoClient(values.MONGODB_URI, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.connect();
    const database = client.db(values.MONGODB_DB_NAME || 'arclivo');
    await database.command({ ping: 1 });
    result('MongoDB ping', true);
    const state = await database
      .collection(values.MONGODB_STATE_COLLECTION || 'app_state')
      .findOne({ _id: 'primary' }, { projection: { _id: 1, revision: 1, schemaVersion: 1 } });
    result('MongoDB primary state', Boolean(state), state ? 'present' : 'not initialized');
    if (state) {
      result('MongoDB revision', Number.isSafeInteger(state.revision));
      result('MongoDB schema version', Number.isSafeInteger(state.schemaVersion));
    }
  } catch (error) {
    result('MongoDB ping', false, error instanceof Error ? error.name : 'connection failure');
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

void checkMongo();
