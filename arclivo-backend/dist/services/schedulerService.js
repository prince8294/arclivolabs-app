"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const config_1 = require("../config");
const store_1 = require("../models/store");
const logger_1 = require("../utils/logger");
const gmailService_1 = require("./gmailService");
class SchedulerService {
    static timer = null;
    static isProcessing = false;
    static start() {
        if (this.timer)
            return;
        logger_1.logger.info('scheduler_started', { pollIntervalMs: config_1.config.schedulerPollMs });
        this.timer = setInterval(() => {
            this.processQueue().catch(error => {
                logger_1.logger.error('scheduler_cycle_failed', { message: error instanceof Error ? error.message : 'unknown' });
            });
        }, config_1.config.schedulerPollMs);
        this.timer.unref();
    }
    static stop() {
        if (!this.timer)
            return;
        clearInterval(this.timer);
        this.timer = null;
        logger_1.logger.info('scheduler_stopped');
    }
    static async deliver(leadId, automated) {
        const claim = await store_1.store.claimEmail(leadId || undefined, automated);
        if (!claim)
            return { success: false, error: 'Email is not eligible, approved, due, or within the daily limit.' };
        const { lead, record } = claim;
        const draft = lead.emailDraft;
        const result = await gmailService_1.GmailService.sendEmail(lead.email, draft.subject, draft.body, record.id);
        const now = new Date().toISOString();
        if (result.success && result.messageId) {
            await store_1.store.completeSend(record.id, result.messageId, result.threadId);
            await store_1.store.addLog({
                leadId: lead.id,
                recipientEmail: lead.email,
                businessName: lead.businessName,
                subject: draft.subject,
                status: 'sent',
                sentAt: now,
                messageId: result.messageId,
            });
            logger_1.logger.info('email_sent', { leadId: lead.id, recordId: record.id, gmailMessageId: result.messageId });
            return { success: true };
        }
        await store_1.store.failSend(record.id, result.errorCategory || 'unknown', result.error || 'Email delivery failed.', !!result.retryable, !!result.uncertain);
        await store_1.store.addLog({
            leadId: lead.id,
            recipientEmail: lead.email,
            businessName: lead.businessName,
            subject: draft.subject,
            status: 'failed',
            sentAt: now,
            error: result.error,
        });
        logger_1.logger.warn('email_not_sent', { leadId: lead.id, recordId: record.id, category: result.errorCategory });
        return { success: false, error: result.error };
    }
    static async processQueue() {
        if (this.isProcessing)
            return;
        this.isProcessing = true;
        try {
            const settings = await store_1.store.getSettings();
            if (!settings.isAutomationRunning || !settings.autoSendEnabled)
                return;
            const claim = await store_1.store.claimEmail(undefined, true);
            if (!claim)
                return;
            const latestSettings = await store_1.store.getSettings();
            if (!latestSettings.isAutomationRunning || !latestSettings.autoSendEnabled) {
                await store_1.store.failSend(claim.record.id, 'temporary', 'Automation paused before delivery.', true, false);
                return;
            }
            const { lead, record } = claim;
            const draft = lead.emailDraft;
            const result = await gmailService_1.GmailService.sendEmail(lead.email, draft.subject, draft.body, record.id);
            const now = new Date().toISOString();
            if (result.success && result.messageId) {
                await store_1.store.completeSend(record.id, result.messageId, result.threadId);
                await store_1.store.addLog({
                    leadId: lead.id,
                    recipientEmail: lead.email,
                    businessName: lead.businessName,
                    subject: draft.subject,
                    status: 'sent',
                    sentAt: now,
                    messageId: result.messageId,
                });
                logger_1.logger.info('scheduled_email_sent', { leadId: lead.id, recordId: record.id });
            }
            else {
                await store_1.store.failSend(record.id, result.errorCategory || 'unknown', result.error || 'Email delivery failed.', !!result.retryable, !!result.uncertain);
                await store_1.store.addLog({
                    leadId: lead.id,
                    recipientEmail: lead.email,
                    businessName: lead.businessName,
                    subject: draft.subject,
                    status: 'failed',
                    sentAt: now,
                    error: result.error,
                });
            }
        }
        finally {
            this.isProcessing = false;
        }
    }
    static async sendSingleLead(leadId) {
        const lead = await store_1.store.getLeadById(leadId);
        if (!lead)
            return { success: false, error: 'Lead not found.' };
        if (!lead.contactPermission || lead.status === 'ineligible' || await store_1.store.isSuppressed(lead.email)) {
            return { success: false, error: 'Contact permission is missing or the contact is suppressed.' };
        }
        if (lead.status === 'sent')
            return { success: false, error: 'Email has already been sent to this lead.' };
        if (!lead.emailDraft?.approved)
            return { success: false, error: 'Draft must be explicitly approved before sending.' };
        return this.deliver(leadId, false);
    }
    static async toggleAutomation(run) {
        await store_1.store.updateSettings({ isAutomationRunning: run });
        await store_1.store.addAuditLog({ action: run ? 'automation_started' : 'automation_paused', actor: 'owner' });
        return run;
    }
}
exports.SchedulerService = SchedulerService;
