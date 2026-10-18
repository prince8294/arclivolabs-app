const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclivo-serverless-tests-'));
const password = 'serverless-test-owner-password';
const salt = 'abcdef0123456789abcdef0123456789';
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

process.env.NODE_ENV = 'test';
process.env.PERSISTENCE_DRIVER = 'json';
process.env.ARCLIVO_DATA_DIR = testDir;
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SIGNING_KEY = 'serverless-test-session-signing-key-long-enough';
process.env.OWNER_PASSWORD_HASH = `scrypt$${salt}$${hash}`;

const { app } = require('../dist/server.js');
const { store } = require('../dist/models/store.js');

test.after(() => fs.rmSync(testDir, { recursive: true, force: true }));

test('health reports the active durable-storage adapter', async () => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'online');
    assert.equal(body.persistence, 'json');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('OAuth PKCE state is persisted and consumed exactly once', async () => {
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 60_000;
  await store.saveOAuthFlow(state, verifier, expiresAt);
  assert.deepEqual(await store.consumeOAuthFlow(state), { verifier, expiresAt });
  assert.equal(await store.consumeOAuthFlow(state), null);
});

test('cron endpoint rejects requests without the configured bearer secret', async () => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/cron/process-email`);
    assert.equal(response.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Vercel runtime defaults to MongoDB and fails closed before JSON initialization', () => {
  const configPath = path.resolve(__dirname, '../dist/config.js');
  const script = `require(${JSON.stringify(configPath)})`;
  const child = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VERCEL: '1',
      PERSISTENCE_DRIVER: '',
      MONGODB_URI: '',
      CRON_SECRET: '',
    },
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /MONGODB_URI/);
  assert.doesNotMatch(child.stderr, /mkdir|db\.json|initJson/);
});
