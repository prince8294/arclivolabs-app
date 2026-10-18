const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclivo-p4-tests-'));
const password = 'test-owner-password';
const salt = '0123456789abcdef0123456789abcdef';
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

process.env.NODE_ENV = 'test';
process.env.ARCLIVO_DATA_DIR = testDir;
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SIGNING_KEY = 'test-session-signing-key-that-is-long-enough-for-security';
process.env.OWNER_PASSWORD_HASH = `scrypt$${salt}$${hash}`;

const { store } = require('../dist/models/store.js');
const { AiCeoService } = require('../dist/services/aiCeoService.js');

test.after(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Phase 4: Store initialization and schema version check', async () => {
  const profile = await store.getCompanyProfile();
  assert.ok(profile);
  assert.equal(profile.companyName, 'Arclivo Labs');
});

function getKolkataDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

test('Phase 4: Seed client, project, tasks, invoice, payments for testing', async () => {
  // 1. Add Client
  const client = await store.addClient({
    clientName: 'Apex Health Corp',
    companyName: 'Apex Healthcare Inc.',
    email: 'contact@apexhealth.in',
    mobile: '+91 98765 43210',
    city: 'Bangalore',
    notes: 'Premium healthcare client',
    status: 'lead_captured',
  });
  assert.ok(client.id);

  // 2. Add Project
  const project = await store.addProject({
    clientId: client.id,
    projectName: 'Healthcare Patient Portal',
    description: 'React Native & Node.js portal',
    techStack: 'React Native, Node.js, Express',
    status: 'in_progress',
    progress: 40,
    progressMode: 'manual',
    budget: 150000,
    deadline: '2026-11-15',
    priority: 'urgent',
    notes: 'Core delivery for Q4',
    milestones: [],
  });
  assert.ok(project.id);

  // 3. Add Tasks (one overdue, one due today, one future)
  const yesterday = getKolkataDate(-1);
  const today = getKolkataDate(0);
  const tomorrow = getKolkataDate(1);

  const tOverdue = await store.addTask({
    projectId: project.id,
    title: 'HIPAA Security Audit',
    description: 'Verify encryption at rest',
    priority: 'urgent',
    status: 'in_progress',
    dueDate: yesterday,
    notes: '',
  });

  const tToday = await store.addTask({
    projectId: project.id,
    title: 'Deploy API Staging Server',
    description: 'Docker container setup',
    priority: 'high',
    status: 'todo',
    dueDate: today,
    notes: '',
  });

  const tFuture = await store.addTask({
    projectId: project.id,
    title: 'Prepare Mobile Release Build',
    description: 'EAS build',
    priority: 'medium',
    status: 'todo',
    dueDate: tomorrow,
    notes: '',
  });

  assert.ok(tOverdue.id);
  assert.ok(tToday.id);
  assert.ok(tFuture.id);

  // 4. Add Invoice
  const invoice = await store.addInvoice({
    clientId: client.id,
    projectId: project.id,
    title: 'Milestone 1: Architecture & Prototyping',
    notes: 'Due in 7 days',
    paymentTerms: 'net_7',
    issueDate: yesterday,
    dueDate: yesterday, // deliberately overdue
    items: [
      { id: 'item_1', description: 'System Architecture Design', quantity: 1, unitRatePaise: 5000000, amountPaise: 5000000 },
    ],
    subtotalPaise: 5000000, // ₹50,000
    taxRatePercent: 0,
    taxAmountPaise: 0,
    discountAmountPaise: 0,
    totalPaise: 5000000, // ₹50,000
    currency: 'INR',
    status: 'issued',
  });
  assert.ok(invoice.id);
  assert.equal(invoice.balancePaise, 5000000);

  // 5. Add Expense
  const expense = await store.addExpense({
    title: 'AWS Cloud Server Hosting',
    description: 'Staging instance',
    category: 'hosting_vps',
    amountPaise: 350000, // ₹3,500
    currency: 'INR',
    expenseDate: today,
    projectId: project.id,
    notes: 'Monthly billing',
  });
  assert.ok(expense.id);
});

test('Phase 4: Smart Business Reminders detects overdue tasks, overdue invoices, and disconnected Gmail', async () => {
  const reminders = await store.getReminders();
  assert.ok(reminders.length >= 2);

  const hasTaskOverdue = reminders.some(r => r.type === 'task_overdue' && r.title.includes('HIPAA Security Audit'));
  const hasInvOverdue = reminders.some(r => r.type === 'invoice_overdue' && r.title.includes('ARCL-INV-'));
  const hasGmailAlert = reminders.some(r => r.type === 'gmail_disconnected');

  assert.ok(hasTaskOverdue, 'Should flag overdue task');
  assert.ok(hasInvOverdue, 'Should flag overdue invoice');
  assert.ok(hasGmailAlert, 'Should alert when Gmail is not connected');

  // Test Dismiss reminder
  const first = reminders[0];
  const dismissed = await store.dismissReminder(first.id);
  assert.equal(dismissed, true);

  const remindersAfterDismiss = await store.getReminders();
  assert.ok(!remindersAfterDismiss.some(r => r.id === first.id));

  // Test Snooze reminder
  const second = remindersAfterDismiss[0];
  const futureSnooze = new Date(Date.now() + 3600000).toISOString();
  const snoozed = await store.snoozeReminder(second.id, futureSnooze);
  assert.equal(snoozed, true);

  const remindersAfterSnooze = await store.getReminders();
  assert.ok(!remindersAfterSnooze.some(r => r.id === second.id));
});

test('Phase 4: AI Smart Daily Planner organizes work into 5-level priority schedule', async () => {
  const plan = await store.generateDailyWorkPlan();
  assert.ok(plan);
  assert.ok(plan.summary);
  assert.equal(plan.prioritySchedule.length, 5);

  // Level 1: Overdue items
  const level1 = plan.prioritySchedule.find(lvl => lvl.level === 1);
  assert.ok(level1);
  assert.ok(level1.items.length > 0);
  assert.ok(level1.items.some(i => i.title.includes('HIPAA Security Audit')));

  // Level 2: Today's scheduled commitments
  const level2 = plan.prioritySchedule.find(lvl => lvl.level === 2);
  assert.ok(level2);
  assert.ok(level2.items.some(i => i.title.includes('Deploy API Staging Server')));
});

test('Phase 4: Smart Business Insights calculates deterministic metrics', async () => {
  const insights = await store.getBusinessInsights();
  assert.ok(insights);
  assert.equal(typeof insights.financials.totalInvoicedPaise, 'number');
  assert.equal(typeof insights.financials.confirmedPaidPaise, 'number');
  assert.equal(typeof insights.financials.cashSurplusPaise, 'number');
  assert.equal(insights.projects.activeProjects, 1);
  assert.ok(insights.tasks.totalTasks >= 3);
  assert.ok(insights.tasks.overdueTasks >= 1);
});

test('Phase 4: AI Business Recommendations returns actionable items derived from live data', async () => {
  const recs = await store.getBusinessRecommendations();
  assert.ok(Array.isArray(recs));
  assert.ok(recs.length > 0);

  const taskRec = recs.find(r => r.category === 'task');
  assert.ok(taskRec, 'Should recommend reviewing overdue tasks');
  assert.equal(taskRec.actionLabel, 'Review Tasks');

  const financeRec = recs.find(r => r.category === 'finance');
  assert.ok(financeRec, 'Should recommend viewing overdue invoices');
  assert.equal(financeRec.actionLabel, 'View Invoices');
});

test('Phase 4: Global Search finds records across multiple categories accurately', async () => {
  // Search for 'Apex' (should match client)
  const clientResults = await store.globalSearch('Apex');
  assert.ok(clientResults.some(r => r.entityType === 'client' && r.title === 'Apex Health Corp'));

  // Search for 'HIPAA' (should match task)
  const taskResults = await store.globalSearch('HIPAA');
  assert.ok(taskResults.some(r => r.entityType === 'task' && r.title === 'HIPAA Security Audit'));

  // Search for 'Healthcare' (should match project)
  const projResults = await store.globalSearch('Healthcare');
  assert.ok(projResults.some(r => r.entityType === 'project' && r.title === 'Healthcare Patient Portal'));

  // Search for 'ARCL-INV' (should match invoice)
  const invResults = await store.globalSearch('ARCL-INV');
  assert.ok(invResults.some(r => r.entityType === 'invoice'));
});

test('Phase 4: Backup Export includes schema metadata and redacts secrets', async () => {
  const backup = await store.exportDataBackup();
  assert.equal(backup.schemaVersion, 4);
  assert.equal(backup.exportFormat, 'arclivo_backup_v4');
  assert.ok(backup.exportedAt);
  assert.ok(backup.summary);
  assert.ok(backup.summary.clientsCount >= 1);
  assert.ok(backup.summary.projectsCount >= 1);
  assert.ok(backup.summary.tasksCount >= 3);
  assert.equal(backup.data.secrets, undefined, 'Secrets must be redacted');
  assert.equal(backup.data.oauth, undefined, 'OAuth tokens must be redacted');
});

test('Phase 4: AI CEO Assistant answers questions with deterministic truth and zero hallucination', async () => {
  // Test 1: "What should I work on today?"
  const q1 = await AiCeoService.chat('What should I work on today?');
  assert.ok(q1.isDeterministic);
  assert.match(q1.reply, /priority focus/i);
  assert.match(q1.reply, /HIPAA Security Audit/);

  // Test 2: "Which tasks are overdue?"
  const q2 = await AiCeoService.chat('Which tasks are overdue?');
  assert.ok(q2.isDeterministic);
  assert.match(q2.reply, /HIPAA Security Audit/);

  // Test 3: "Which clients have pending payments?"
  const q3 = await AiCeoService.chat('Which clients have pending payments?');
  assert.ok(q3.isDeterministic);
  assert.match(q3.reply, /Apex Health Corp/);
  assert.match(q3.reply, /50,000/); // ₹50,000 balance

  // Test 4: "Which projects are pending?"
  const q4 = await AiCeoService.chat('Which projects are pending?');
  assert.ok(q4.isDeterministic);
  assert.match(q4.reply, /Healthcare Patient Portal/);

  // Test 5: "Summarize my current business status"
  const q5 = await AiCeoService.chat('Summarize my current business status.');
  assert.ok(q5.isDeterministic);
  assert.match(q5.reply, /Active Clients/);
  assert.match(q5.reply, /Active Projects/);
  assert.match(q5.reply, /50,000/);

  // Test Quick Questions
  const quickQuestions = await AiCeoService.getQuickQuestions();
  assert.ok(Array.isArray(quickQuestions));
  assert.ok(quickQuestions.length > 0);
  assert.ok(quickQuestions.includes('What should I work on today?'));
});
