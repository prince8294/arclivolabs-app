const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclivo-tests-'));
const password = 'correct horse battery staple';
const salt = '0123456789abcdef0123456789abcdef';
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
process.env.NODE_ENV = 'test';
process.env.ARCLIVO_DATA_DIR = testDir;
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SIGNING_KEY = 'test-session-signing-key-that-is-long-enough';
process.env.OWNER_PASSWORD_HASH = `scrypt$${salt}$${hash}`;
process.env.SCHEDULER_POLL_MS = '60000';

const { CsvService } = require('../dist/services/csvService.js');
const { AiService } = require('../dist/services/aiService.js');
const { GmailService } = require('../dist/services/gmailService.js');
const { SchedulerService } = require('../dist/services/schedulerService.js');
const { store } = require('../dist/models/store.js');
const { app } = require('../dist/server.js');

let sendCount = 0;
GmailService.setTestTransport(async (_to, _subject, _body, internalMessageId) => {
  sendCount += 1;
  await new Promise(resolve => setTimeout(resolve, 20));
  return { success: true, messageId: `gmail_${internalMessageId}`, threadId: 'thread_test' };
});

test.after(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('imports valid CSV rows, records consent, and flags missing permission', async () => {
  const result = await CsvService.importCsv(`Business Name,Email,Website,Category,City,Contact Permission,Permission Source,Permission Evidence
Acme Dental,contact@acmedental.com,https://acmedental.com,Dentistry,Austin,Yes,website form,form-123
Opted Out Corp,optout@firm.com,https://firm.com,Real Estate,Denver,No,csv,none`);
  assert.equal(result.importedCount, 2);
  assert.equal(result.ineligibleCount, 1);
  const lead = await store.findLeadByEmail('contact@acmedental.com');
  assert.equal(lead.permissionSource, 'website form');
  assert.equal(lead.permissionEvidence, 'form-123');
});

test('detects duplicates and validates email syntax', async () => {
  const result = await CsvService.importCsv(`Business Name,Email,Website,Category,City,Contact Permission
Copy,contact@acmedental.com,,General,Austin,Yes
Bad,not-an-email,,General,Austin,Yes
Good,hello@validbusiness.org,,General,Austin,Yes
Duplicate,hello@validbusiness.org,,General,Austin,Yes`);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.importedCount, 1);
});

test('generated drafts require explicit approval and include opt-out language', async () => {
  const lead = await store.findLeadByEmail('contact@acmedental.com');
  const draft = await AiService.generateEmail(lead);
  assert.equal(draft.approved, false);
  assert.match(draft.body, /unsubscribe/i);
  await store.updateLead(lead.id, { emailDraft: draft, emailState: 'draft' });
});

test('suppressed contacts cannot be approved or sent and remain suppressed on re-import', async () => {
  const lead = await store.findLeadByEmail('contact@acmedental.com');
  await store.addSuppression(lead.email, 'Manual opt-out', 'opt_out');
  assert.equal(await store.approveLead(lead.id), null);
  const result = await SchedulerService.sendSingleLead(lead.id);
  assert.equal(result.success, false);
  assert.equal(sendCount, 0);
  await store.deleteLead(lead.id);
  const reimport = await CsvService.importCsv(`Business Name,Email,Website,Category,City,Contact Permission
Acme Again,contact@acmedental.com,,Dentistry,Austin,Yes`);
  assert.equal(reimport.importedCount, 1);
  const reimported = await store.findLeadByEmail('contact@acmedental.com');
  assert.equal(reimported.emailState, 'suppressed');
  assert.equal(reimported.status, 'ineligible');
});

test('concurrent manual requests produce at most one Gmail send', async () => {
  const lead = await store.findLeadByEmail('hello@validbusiness.org');
  const draft = AiService.generateDeterministicEmail(lead);
  await store.updateLead(lead.id, { emailDraft: draft, emailState: 'draft' });
  await store.approveLead(lead.id);
  const results = await Promise.all([
    SchedulerService.sendSingleLead(lead.id),
    SchedulerService.sendSingleLead(lead.id),
  ]);
  assert.equal(results.filter(result => result.success).length, 1);
  assert.equal(sendCount, 1);
  const record = (await store.getEmailRecords()).find(item => item.leadId === lead.id);
  assert.equal(record.state, 'sent');
  assert.ok(record.gmailMessageId);
});

test('daily sending limit blocks additional sends', async () => {
  await store.updateSettings({ dailyLimit: 1 });
  const importResult = await CsvService.importCsv(`Business Name,Email,Website,Category,City,Contact Permission
Limit Test,limit@validbusiness.org,,General,Austin,Yes`);
  const lead = importResult.importedLeads[0];
  await store.updateLead(lead.id, { emailDraft: AiService.generateDeterministicEmail(lead), emailState: 'draft' });
  await store.approveLead(lead.id);
  const result = await SchedulerService.sendSingleLead(lead.id);
  assert.equal(result.success, false);
  assert.equal(sendCount, 1);
});

test('invalid tokens are rejected and owner login issues a usable session', async () => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    const invalid = await fetch(`${base}/stats`, { headers: { Authorization: 'Bearer invalid' } });
    assert.equal(invalid.status, 401);
    const wrongLogin = await fetch(`${base}/auth/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong password' }),
    });
    assert.equal(wrongLogin.status, 401);
    const login = await fetch(`${base}/auth/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const stats = await fetch(`${base}/stats`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(stats.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('restart recovery changes in-flight sends to delivery_unconfirmed', () => {
  const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclivo-restart-'));
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(restartDir, 'db.json'), JSON.stringify({
    schemaVersion: 2,
    leads: [],
    settings: {
      dailyLimit: 5, autoSendEnabled: false, isAutomationRunning: false, aiProvider: 'gemini',
      gmailConnected: false, gmailUserEmail: '', sentCountToday: 0, lastSentResetDate: now.slice(0, 10),
      businessTimezone: 'Asia/Kolkata', authSessionVersion: 1,
    },
    oauth: {}, secrets: {}, logs: [], suppressions: [], auditLogs: [],
    emailRecords: [{
      id: 'msg_restart', queueId: 'queue_restart', idempotencyKey: 'restart', leadId: 'lead_restart',
      recipientEmail: 'restart@validbusiness.org', state: 'sending', attemptCount: 1, createdAt: now, updatedAt: now,
    }],
  }));
  const script = `require(${JSON.stringify(path.resolve(__dirname, '../dist/models/store.js'))}).store.getEmailRecords().then(r=>process.stdout.write(r[0].state))`;
  const child = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, ARCLIVO_DATA_DIR: restartDir }, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'delivery_unconfirmed');
  fs.rmSync(restartDir, { recursive: true, force: true });
});
