const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclivo-p5-tests-'));
const password = 'phase-five-owner-password';
const salt = '0123456789abcdef0123456789abcdef';
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

process.env.NODE_ENV = 'test';
process.env.ARCLIVO_DATA_DIR = testDir;
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SIGNING_KEY = 'phase-five-session-signing-key-long-enough';
process.env.OWNER_PASSWORD_HASH = `scrypt$${salt}$${hash}`;

const { app } = require('../dist/server.js');
const { GmailService } = require('../dist/services/gmailService.js');

let mockSendCount = 0;
GmailService.setTestTransport(async (_to, _subject, _body, internalMessageId) => {
  mockSendCount += 1;
  return { success: true, messageId: `mock_${internalMessageId}`, threadId: 'mock_thread' };
});

test.after(() => fs.rmSync(testDir, { recursive: true, force: true }));

test('Phase 5: complete owner workflow keeps API contracts and financial relationships consistent', async () => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api`;
  let token = '';

  const request = async (method, endpoint, body, expectedStatus = 200) => {
    const response = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    assert.equal(response.status, expectedStatus, `${method} ${endpoint}: ${JSON.stringify(payload)}`);
    return payload;
  };

  try {
    const login = await request('POST', '/auth/session', { password });
    token = login.token;

    const csv = `Business Name,Email,Website,Category,City,Contact Permission,Permission Source,Permission Evidence\nPhase Five Co,owner@phasefive.example,https://phasefive.example,Software,Pune,Yes,test fixture,fixture-1`;
    const imported = await request('POST', '/leads/upload', { csvText: csv });
    assert.equal(imported.importedCount, 1);
    const lead = imported.importedLeads[0];

    const generated = await request('POST', `/leads/${lead.id}/generate-draft`);
    assert.equal(generated.lead.emailDraft.approved, false);
    assert.match(generated.lead.emailDraft.body, /unsubscribe/i);
    await request('POST', `/leads/${lead.id}/approve`);
    const sent = await request('POST', `/emails/send/${lead.id}`);
    assert.equal(sent.success, true);
    assert.equal(mockSendCount, 1);

    const converted = await request('POST', `/leads/${lead.id}/convert-to-client`, { clientName: 'Phase Five Owner' }, 201);
    const client = converted.client;
    const projectResult = await request('POST', '/projects', {
      clientId: client.id,
      projectName: 'Phase Five Integration',
      projectType: 'web_application',
      priority: 'high',
      status: 'in_progress',
      progressMode: 'manual',
      deadline: '2026-12-31',
    }, 201);
    const project = projectResult.project;
    await request('POST', `/projects/${project.id}/milestones`, { title: 'Release validation', dueDate: '2026-12-15' }, 201);

    const taskResult = await request('POST', '/tasks', {
      projectId: project.id,
      title: 'Validate Android release',
      priority: 'high',
      status: 'todo',
      dueDate: '2026-12-10',
      checklist: [{ id: 'check_1', text: 'Run Expo Doctor', isChecked: false }],
    }, 201);
    await request('PUT', `/tasks/${taskResult.task.id}`, { status: 'completed' });

    const proposalResult = await request('POST', '/proposals', {
      clientId: client.id,
      projectId: project.id,
      title: 'Phase Five Delivery',
      services: [{ serviceName: 'Integration QA', amountPaise: 1000000 }],
      discountPaise: 0,
    }, 201);
    assert.ok(proposalResult.proposal.id);
    await request('POST', '/proposals', {
      clientId: client.id,
      title: 'Invalid negative proposal',
      services: [{ serviceName: 'Small service', amountPaise: 100 }],
      discountPaise: 101,
    }, 400);
    const proposalId = proposalResult.proposal.id;
    await request('PUT', `/proposals/${proposalId}`, { status: 'accepted' });
    const proposalDetail = await request('GET', `/proposals/${proposalId}`);
    assert.equal(proposalDetail.proposal.status, 'accepted');
    assert.equal(proposalDetail.client.id, client.id);
    assert.equal(proposalDetail.project.id, project.id);

    const invoiceResult = await request('POST', `/invoices/from-proposal/${proposalId}`, {}, 201);
    const invoice = invoiceResult.invoice;
    assert.equal(invoice.totalPaise, 1000000);
    assert.equal(invoice.balancePaise, 1000000);

    const firstPaymentResult = await request('POST', '/payments', {
      invoiceId: invoice.id,
      amountPaise: 400000,
      method: 'upi',
      referenceId: 'P5-PART-1',
    }, 201);
    await request('POST', '/payments', {
      invoiceId: invoice.id,
      amountPaise: 400000,
      method: 'upi',
      referenceId: 'P5-PART-1',
    }, 400);
    await request('POST', `/payments/${firstPaymentResult.payment.id}/confirm`, {});
    let invoiceDetail = await request('GET', `/invoices/${invoice.id}`);
    assert.equal(invoiceDetail.invoice.balancePaise, 600000);
    assert.equal(invoiceDetail.invoice.status, 'partially_paid');

    const secondPaymentResult = await request('POST', '/payments', {
      invoiceId: invoice.id,
      amountPaise: 600000,
      method: 'bank_transfer',
      referenceId: 'P5-FINAL-2',
    }, 201);
    await request('POST', `/payments/${secondPaymentResult.payment.id}/confirm`, {});
    invoiceDetail = await request('GET', `/invoices/${invoice.id}`);
    assert.equal(invoiceDetail.invoice.balancePaise, 0);
    assert.equal(invoiceDetail.invoice.status, 'paid');
    assert.equal(invoiceDetail.payments.length, 2);

    await request('POST', `/payments/${secondPaymentResult.payment.id}/reverse`, { reason: 'Phase 5 reversal regression' });
    invoiceDetail = await request('GET', `/invoices/${invoice.id}`);
    assert.equal(invoiceDetail.invoice.balancePaise, 600000);
    assert.equal(invoiceDetail.invoice.status, 'partially_paid');
    const replacementPayment = await request('POST', '/payments', {
      invoiceId: invoice.id,
      amountPaise: 600000,
      method: 'cheque',
      referenceId: 'P5-REPLACEMENT-3',
    }, 201);
    await request('POST', `/payments/${replacementPayment.payment.id}/confirm`, {});
    invoiceDetail = await request('GET', `/invoices/${invoice.id}`);
    assert.equal(invoiceDetail.invoice.balancePaise, 0);
    assert.equal(invoiceDetail.invoice.status, 'paid');

    const expenseResult = await request('POST', '/expenses', {
      title: 'Phase Five test infrastructure',
      category: 'hosting_vps',
      amountPaise: 125000,
      projectId: project.id,
      expenseDate: '2026-10-18',
    }, 201);
    assert.ok(expenseResult.expense.id);
    const updatedExpense = await request('PUT', `/expenses/${expenseResult.expense.id}`, { notes: 'Verified in Phase 5' });
    assert.equal(updatedExpense.expense.notes, 'Verified in Phase 5');

    const finance = await request('GET', '/finance/dashboard');
    assert.equal(finance.totalInvoicedPaise, 1000000);
    assert.equal(finance.confirmedPaidPaise, 1000000);
    assert.equal(finance.outstandingPaise, 0);
    assert.equal(finance.totalExpensesPaise, 125000);

    const assistant = await request('POST', '/ai/ceo/chat', { message: 'Summarize my current business status.' });
    assert.equal(assistant.isDeterministic, true);
    assert.match(assistant.reply, /Active Projects/i);
    const plan = await request('GET', '/planner/today');
    assert.equal(plan.prioritySchedule.length, 5);
    const activity = await request('GET', '/activity-logs?limit=50');
    assert.ok(activity.logs.length > 0);

    await request('PUT', '/company-profile', { companyName: '<script>alert("xss")</script>' });
    const htmlResponse = await fetch(`${base}/invoices/${invoice.id}/html`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(htmlResponse.status, 200);
    const invoiceHtml = await htmlResponse.text();
    assert.doesNotMatch(invoiceHtml, /<script>alert/);
    assert.match(invoiceHtml, /&lt;script&gt;/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
