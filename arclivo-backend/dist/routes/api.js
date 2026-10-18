"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const config_1 = require("../config");
const security_1 = require("../middleware/security");
const store_1 = require("../models/store");
const csvService_1 = require("../services/csvService");
const aiService_1 = require("../services/aiService");
const gmailService_1 = require("../services/gmailService");
const schedulerService_1 = require("../services/schedulerService");
const security_2 = require("../utils/security");
const router = (0, express_1.Router)();
const loginLimiter = (0, security_1.rateLimit)({ windowMs: 15 * 60_000, max: 10 });
const sendLimiter = (0, security_1.rateLimit)({ windowMs: 60_000, max: 10 });
const generationLimiter = (0, security_1.rateLimit)({ windowMs: 60_000, max: 20 });
const safeError = (res, error, status = 500) => {
    if (status >= 500)
        res.status(status).json({ error: 'Internal server error.' });
    else
        res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
};
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : null;
const validEmail = (value) => typeof value === 'string' && value.length <= 254 && csvService_1.CsvService.isValidEmail(value.toLowerCase().trim());
router.post('/auth/session', security_2.requireHttpsInProduction, loginLimiter, async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!config_1.config.ownerPasswordHash || !config_1.config.sessionSigningKey) {
        res.status(503).json({ error: 'Owner authentication is not configured.' });
        return;
    }
    if (!password || password.length > 256 || !(0, security_2.verifyOwnerPassword)(password)) {
        res.status(401).json({ error: 'Invalid owner credentials.' });
        return;
    }
    const settings = await store_1.store.getSettings();
    await store_1.store.addAuditLog({ action: 'session_created', actor: 'owner' });
    res.json({ token: (0, security_2.createSessionToken)(settings.authSessionVersion), expiresIn: config_1.config.sessionTtlSeconds });
});
router.get('/auth/google/callback', async (req, res) => {
    const code = text(req.query.code, 4096);
    const state = text(req.query.state, 256);
    if (!code || !state) {
        res.status(400).send('Missing or invalid authorization response.');
        return;
    }
    const result = await gmailService_1.GmailService.handleAuthCallback(code, state);
    const escape = (value) => value.replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] || character);
    if (!result.success) {
        res.status(400).send(`<h2>Gmail connection failed</h2><p>${escape(result.error || 'Please try again.')}</p>`);
        return;
    }
    res.send(`<h2>Gmail connected successfully</h2><p>${escape(result.userEmail || '')}</p><p>You can return to the Arclivo app.</p>`);
});
router.get('/internal/cron/process-email', async (req, res) => {
    const provided = req.header('authorization') || '';
    const expected = config_1.config.cronSecret ? `Bearer ${config_1.config.cronSecret}` : '';
    const providedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    const authorized = expectedBytes.length > 0 &&
        providedBytes.length === expectedBytes.length &&
        crypto_1.default.timingSafeEqual(providedBytes, expectedBytes);
    if (!authorized) {
        res.status(401).json({ error: 'Unauthorized scheduled invocation.' });
        return;
    }
    await schedulerService_1.SchedulerService.processQueue();
    res.json({ success: true });
});
router.use(security_1.requireOwner);
router.post('/auth/logout', async (_req, res) => {
    await store_1.store.rotateSessionVersion();
    await store_1.store.addAuditLog({ action: 'sessions_revoked', actor: 'owner' });
    res.json({ success: true });
});
router.get('/stats', async (_req, res) => res.json(await store_1.store.getStats()));
router.post('/automation/toggle', async (req, res) => {
    const current = await store_1.store.getSettings();
    if (req.body?.running !== undefined && typeof req.body.running !== 'boolean') {
        safeError(res, new Error('running must be boolean.'), 400);
        return;
    }
    const target = typeof req.body?.running === 'boolean' ? req.body.running : !current.isAutomationRunning;
    await schedulerService_1.SchedulerService.toggleAutomation(target);
    res.json({ success: true, isAutomationRunning: target, stats: await store_1.store.getStats() });
});
router.get('/leads', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 200) : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !['all', 'pending', 'sent', 'failed', 'ineligible'].includes(status)) {
        safeError(res, new Error('Invalid lead status.'), 400);
        return;
    }
    const leads = await store_1.store.getLeads({ search, status });
    res.json({ leads, total: leads.length });
});
router.post('/leads/upload', (0, security_1.rateLimit)({ windowMs: 60_000, max: 5 }), async (req, res) => {
    if (typeof req.body?.csvText !== 'string' || !req.body.csvText.trim() || req.body.csvText.length > 1_000_000) {
        safeError(res, new Error('csvText is required and must not exceed 1 MB.'), 400);
        return;
    }
    const result = await csvService_1.CsvService.importCsv(req.body.csvText);
    await store_1.store.addAuditLog({ action: 'csv_imported', actor: 'owner', details: {
            importedCount: result.importedCount,
            duplicateCount: result.duplicateCount,
            invalidCount: result.invalidCount,
        } });
    res.json(result);
});
router.delete('/leads/:id', async (req, res) => {
    const id = text(req.params.id, 200);
    if (!id || !(await store_1.store.deleteLead(id))) {
        safeError(res, new Error('Lead not found.'), 404);
        return;
    }
    await store_1.store.addAuditLog({ action: 'lead_deleted', actor: 'owner', targetType: 'lead', targetId: id });
    res.json({ success: true, message: 'Lead removed successfully.' });
});
router.delete('/leads', async (_req, res) => {
    await store_1.store.clearAllLeads();
    await store_1.store.addAuditLog({ action: 'all_leads_cleared', actor: 'owner' });
    res.json({ success: true, message: 'All leads cleared. Delivery and suppression history was retained.' });
});
router.get('/emails/drafts', async (_req, res) => {
    const leads = await store_1.store.getLeads();
    res.json({ drafts: leads.filter(lead => lead.emailDraft?.body) });
});
router.post('/leads/:id/generate-draft', generationLimiter, async (req, res) => {
    const lead = await store_1.store.getLeadById(req.params.id);
    if (!lead)
        return safeError(res, new Error('Lead not found.'), 404);
    if (!lead.contactPermission || lead.status === 'ineligible' || await store_1.store.isSuppressed(lead.email)) {
        return safeError(res, new Error('Lead is not eligible for outreach.'), 400);
    }
    const draft = await aiService_1.AiService.generateEmail(lead);
    const updated = await store_1.store.updateLead(lead.id, { emailDraft: draft, emailState: 'draft' });
    res.json({ success: true, lead: updated });
});
router.put('/leads/:id/draft', async (req, res) => {
    const subject = text(req.body?.subject, 300);
    const body = text(req.body?.body, 50_000);
    if (!subject || !body)
        return safeError(res, new Error('Valid subject and body are required.'), 400);
    const lead = await store_1.store.getLeadById(req.params.id);
    if (!lead)
        return safeError(res, new Error('Lead not found.'), 404);
    const updated = await store_1.store.updateLead(lead.id, {
        emailDraft: { subject, body, approved: false, customized: true, generatedAt: lead.emailDraft?.generatedAt },
        emailState: 'draft',
    });
    res.json({ success: true, lead: updated });
});
router.post('/leads/:id/approve', async (req, res) => {
    const lead = await store_1.store.approveLead(req.params.id);
    if (!lead)
        return safeError(res, new Error('Lead or eligible draft not found.'), 400);
    await store_1.store.addAuditLog({ action: 'draft_approved', actor: 'owner', targetType: 'lead', targetId: lead.id });
    res.json({ success: true, lead });
});
router.post('/emails/generate-all', generationLimiter, async (_req, res) => {
    res.json({ success: true, ...(await aiService_1.AiService.generateDraftsForAllPending()) });
});
router.post('/emails/send/:id', sendLimiter, async (req, res) => {
    const result = await schedulerService_1.SchedulerService.sendSingleLead(req.params.id);
    if (!result.success)
        return res.status(400).json(result);
    res.json({ success: true, lead: await store_1.store.getLeadById(req.params.id) });
});
router.get('/emails/logs', async (_req, res) => res.json({ logs: await store_1.store.getLogs(50) }));
router.get('/emails/records', async (_req, res) => res.json({ records: await store_1.store.getEmailRecords() }));
router.post('/emails/records/:id/reconcile', async (req, res) => {
    if (typeof req.body?.delivered !== 'boolean')
        return safeError(res, new Error('delivered must be boolean.'), 400);
    const messageId = req.body.delivered ? text(req.body?.gmailMessageId, 500) : undefined;
    if (req.body.delivered && !messageId)
        return safeError(res, new Error('gmailMessageId is required.'), 400);
    const resolved = await store_1.store.resolveUnconfirmed(req.params.id, req.body.delivered, messageId || undefined);
    if (!resolved)
        return safeError(res, new Error('Unconfirmed record not found.'), 404);
    await store_1.store.addAuditLog({ action: 'delivery_reconciled', actor: 'owner', targetType: 'email_record', targetId: req.params.id, details: { delivered: req.body.delivered } });
    res.json({ success: true });
});
router.get('/settings', async (_req, res) => {
    const settings = await store_1.store.getSettings();
    const hasAiApiKey = await store_1.store.hasAiApiKey();
    res.json({ ...settings, hasAiApiKey, aiApiKeyMasked: hasAiApiKey ? '••••••••••••' : '' });
});
router.put('/settings', async (req, res) => {
    const updates = {};
    if (req.body?.dailyLimit !== undefined) {
        if (!Number.isSafeInteger(req.body.dailyLimit) || req.body.dailyLimit < 1 || req.body.dailyLimit > 500) {
            return safeError(res, new Error('dailyLimit must be an integer from 1 to 500.'), 400);
        }
        updates.dailyLimit = req.body.dailyLimit;
    }
    if (req.body?.autoSendEnabled !== undefined) {
        if (typeof req.body.autoSendEnabled !== 'boolean')
            return safeError(res, new Error('autoSendEnabled must be boolean.'), 400);
        updates.autoSendEnabled = req.body.autoSendEnabled;
    }
    if (req.body?.aiProvider !== undefined) {
        if (!['gemini', 'openai', 'anthropic'].includes(req.body.aiProvider))
            return safeError(res, new Error('Invalid AI provider.'), 400);
        updates.aiProvider = req.body.aiProvider;
    }
    if (req.body?.businessTimezone !== undefined) {
        const timezone = text(req.body.businessTimezone, 100);
        try {
            if (!timezone)
                throw new Error();
            new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
            updates.businessTimezone = timezone;
        }
        catch {
            return safeError(res, new Error('Invalid IANA business timezone.'), 400);
        }
    }
    if (req.body?.aiApiKey !== undefined) {
        const apiKey = text(req.body.aiApiKey, 500);
        if (!apiKey)
            return safeError(res, new Error('Invalid AI API key.'), 400);
        await store_1.store.saveAiApiKey(apiKey);
    }
    const settings = await store_1.store.updateSettings(updates);
    const hasAiApiKey = await store_1.store.hasAiApiKey();
    await store_1.store.addAuditLog({ action: 'settings_updated', actor: 'owner', details: { fields: Object.keys(updates), aiKeyUpdated: req.body?.aiApiKey !== undefined } });
    res.json({ ...settings, hasAiApiKey, aiApiKeyMasked: hasAiApiKey ? '••••••••••••' : '' });
});
router.post('/settings/test-gmail', sendLimiter, async (_req, res) => {
    const result = await gmailService_1.GmailService.testConnection();
    res.json({ ...result, message: result.connected ? `Connected to ${result.userEmail}` : result.error });
});
router.get('/auth/google/url', sendLimiter, async (_req, res) => {
    try {
        res.json({ url: await gmailService_1.GmailService.createAuthUrl() });
    }
    catch (error) {
        safeError(res, error, 503);
    }
});
router.post('/auth/disconnect', sendLimiter, async (_req, res) => {
    await gmailService_1.GmailService.disconnect();
    res.json({ success: true, message: 'Gmail disconnected.' });
});
router.get('/suppressions', async (_req, res) => res.json({ suppressions: await store_1.store.getSuppressions() }));
router.post('/suppressions', async (req, res) => {
    if (!validEmail(req.body?.email))
        return safeError(res, new Error('Valid email is required.'), 400);
    const reason = text(req.body?.reason, 500);
    const source = req.body?.source || 'manual';
    if (!reason || !['manual', 'opt_out', 'bounce', 'complaint', 'import'].includes(source)) {
        return safeError(res, new Error('Valid reason and suppression source are required.'), 400);
    }
    const suppression = await store_1.store.addSuppression(req.body.email, reason, source);
    await store_1.store.addAuditLog({ action: 'contact_suppressed', actor: 'owner', targetType: 'suppression', targetId: suppression.id });
    res.status(201).json({ success: true, suppression });
});
router.delete('/suppressions/:id', async (req, res) => {
    if (!(await store_1.store.removeSuppression(req.params.id)))
        return safeError(res, new Error('Suppression not found.'), 404);
    await store_1.store.addAuditLog({ action: 'suppression_removed', actor: 'owner', targetType: 'suppression', targetId: req.params.id });
    res.json({ success: true, message: 'Suppression removed. Existing leads remain ineligible until manually reviewed.' });
});
router.get('/audit-logs', async (_req, res) => res.json({ auditLogs: await store_1.store.getAuditLogs(100) }));
exports.default = router;
