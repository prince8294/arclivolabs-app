import { config } from '../config';
import { store } from '../models/store';
import { logger } from '../utils/logger';
import { GmailService } from './gmailService';

export class SchedulerService {
  private static timer: NodeJS.Timeout | null = null;
  private static isProcessing = false;

  static start(): void {
    if (this.timer) return;
    logger.info('scheduler_started', { pollIntervalMs: config.schedulerPollMs });
    this.timer = setInterval(() => {
      this.processQueue().catch(error => {
        logger.error('scheduler_cycle_failed', { message: error instanceof Error ? error.message : 'unknown' });
      });
    }, config.schedulerPollMs);
    this.timer.unref();
  }

  static stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('scheduler_stopped');
  }

  private static async deliver(leadId: string, automated: boolean): Promise<{ success: boolean; error?: string }> {
    const claim = await store.claimEmail(leadId || undefined, automated);
    if (!claim) return { success: false, error: 'Email is not eligible, approved, due, or within the daily limit.' };
    const { lead, record } = claim;
    const draft = lead.emailDraft!;
    const result = await GmailService.sendEmail(lead.email, draft.subject, draft.body, record.id);
    const now = new Date().toISOString();

    if (result.success && result.messageId) {
      await store.completeSend(record.id, result.messageId, result.threadId);
      await store.addLog({
        leadId: lead.id,
        recipientEmail: lead.email,
        businessName: lead.businessName,
        subject: draft.subject,
        status: 'sent',
        sentAt: now,
        messageId: result.messageId,
      });
      logger.info('email_sent', { leadId: lead.id, recordId: record.id, gmailMessageId: result.messageId });
      return { success: true };
    }

    await store.failSend(
      record.id,
      result.errorCategory || 'unknown',
      result.error || 'Email delivery failed.',
      !!result.retryable,
      !!result.uncertain
    );
    await store.addLog({
      leadId: lead.id,
      recipientEmail: lead.email,
      businessName: lead.businessName,
      subject: draft.subject,
      status: 'failed',
      sentAt: now,
      error: result.error,
    });
    logger.warn('email_not_sent', { leadId: lead.id, recordId: record.id, category: result.errorCategory });
    return { success: false, error: result.error };
  }

  static async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const settings = await store.getSettings();
      if (!settings.isAutomationRunning || !settings.autoSendEnabled) return;
      const claim = await store.claimEmail(undefined, true);
      if (!claim) return;

      const latestSettings = await store.getSettings();
      if (!latestSettings.isAutomationRunning || !latestSettings.autoSendEnabled) {
        await store.failSend(claim.record.id, 'temporary', 'Automation paused before delivery.', true, false);
        return;
      }

      const { lead, record } = claim;
      const draft = lead.emailDraft!;
      const result = await GmailService.sendEmail(lead.email, draft.subject, draft.body, record.id);
      const now = new Date().toISOString();
      if (result.success && result.messageId) {
        await store.completeSend(record.id, result.messageId, result.threadId);
        await store.addLog({
          leadId: lead.id,
          recipientEmail: lead.email,
          businessName: lead.businessName,
          subject: draft.subject,
          status: 'sent',
          sentAt: now,
          messageId: result.messageId,
        });
        logger.info('scheduled_email_sent', { leadId: lead.id, recordId: record.id });
      } else {
        await store.failSend(
          record.id,
          result.errorCategory || 'unknown',
          result.error || 'Email delivery failed.',
          !!result.retryable,
          !!result.uncertain
        );
        await store.addLog({
          leadId: lead.id,
          recipientEmail: lead.email,
          businessName: lead.businessName,
          subject: draft.subject,
          status: 'failed',
          sentAt: now,
          error: result.error,
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  static async sendSingleLead(leadId: string): Promise<{ success: boolean; error?: string }> {
    const lead = await store.getLeadById(leadId);
    if (!lead) return { success: false, error: 'Lead not found.' };
    if (!lead.contactPermission || lead.status === 'ineligible' || await store.isSuppressed(lead.email)) {
      return { success: false, error: 'Contact permission is missing or the contact is suppressed.' };
    }
    if (lead.status === 'sent') return { success: false, error: 'Email has already been sent to this lead.' };
    if (!lead.emailDraft?.approved) return { success: false, error: 'Draft must be explicitly approved before sending.' };
    return this.deliver(leadId, false);
  }

  static async toggleAutomation(run: boolean): Promise<boolean> {
    await store.updateSettings({ isAutomationRunning: run });
    await store.addAuditLog({ action: run ? 'automation_started' : 'automation_paused', actor: 'owner' });
    return run;
  }
}
